#!/usr/bin/env bash
# 启动本地 ComfyUI 服务（D:\ComfyUI Windows 便携版）
# 用法：bash scripts/comfy-start.sh   （独立进程后台启动，日志落 logs/comfyui.log）
set -euo pipefail

# 统一切到 v3 根目录（脚本可在任意位置调用）
cd "$(dirname "$0")/.."
mkdir -p logs

COMFY_DIR="${COMFY_DIR:-D:/ComfyUI}"
LOG="$(pwd)/logs/comfyui.log"
BASE_URL="${COMFY_URL:-http://127.0.0.1:8188}"

# 已在运行则跳过（幂等）
if curl -s -o /dev/null --max-time 2 "$BASE_URL/system_stats"; then
  echo "[comfy] 已在运行（$BASE_URL），跳过启动"
  exit 0
fi

if [ ! -x "$COMFY_DIR/python_embeded/python.exe" ]; then
  echo "[comfy] 未找到 $COMFY_DIR/python_embeded/python.exe —— 请确认便携版已解压到 $COMFY_DIR"
  exit 1
fi

echo "[comfy] 启动 ComfyUI（$COMFY_DIR）→ 日志 $LOG"
# PowerShell 只认 Windows 路径，MSYS 风格（/d/...）必须先转换；进程用 Start-Process 完全独立于当前 shell
# --enable-cors-header *：App 浏览器直连必须（ComfyUI 默认对跨域 Origin 返回 403）
# --listen 0.0.0.0：手机端直连必须（默认只听 127.0.0.1，局域网设备连不上；Windows 防火墙首次会弹放行确认，选「允许」）
# [2026-11-14 曾加 --disable-dynamic-vram]：当时 D 盘 98% 满，comfy_aimdo 流式加载读 20G 模型分片必败，回退 legacy CPU offload。
# [2026-11-19 移除]：D 盘已清理（63G 可用），触发条件消失；且实测 legacy CPU offload 是性能灾难——
#   16MP 三参考 30+ 分钟（权重页换页到磁盘，N 卡 0% 等 CPU 算 offload 层），
#   而 ComfyUI Desktop 动态显存模式（CUDA 共享内存 fallback，权重驻 RAM 由 N 卡 DMA 直读）同任务仅 4 分钟。
#   若 D 盘再度逼近满盘导致流式加载失败，再临时加回此参数。
# --use-sage-attention：2026-11-15 MSVC Build Tools 补装后启用（tcc 失败根因=无 MSVC 编译器，官方 setup 已补）
# SageAttention JIT 需 Windows SDK + MSVC include/lib（triton tcc/clang 编译 CUDA stub 用）
SDK_VER="10.0.26100.0"
SDK_ROOT="C:\Program Files (x86)\Windows Kits\10"
# MSVC 实际装在 D:/vstool（优先），其次默认 BuildTools 路径；都没有则跳过 sage，不能让 set -e 静默退出
MSVC_DIR=""
for base in "/d/vstool/VC/Tools/MSVC" "/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC"; do
  cand=$(ls -d "$base"/*/ 2>/dev/null | tail -1 || true)
  if [ -n "$cand" ] && [ -f "${cand}bin/Hostx64/x64/cl.exe" ]; then MSVC_DIR="$(cygpath -w "${cand%/}")"; break; fi
done
SAGE_ARG=""
# 默认不开 sage：2511 开 sage 会输出全黑图（NaN），仅跑 H3 视频时用 COMFY_SAGE=1 启动
if [ "${COMFY_SAGE:-0}" = "1" ] && [ -n "$MSVC_DIR" ]; then
  SAGE_ARG="'--use-sage-attention',"
  export INCLUDE="${MSVC_DIR}\include;${SDK_ROOT}\Include\\${SDK_VER}\ucrt;${SDK_ROOT}\Include\\${SDK_VER}\shared;${SDK_ROOT}\Include\\${SDK_VER}\um;${SDK_ROOT}\Include\\${SDK_VER}\winrt"
  export LIB="${MSVC_DIR}\lib\x64;${SDK_ROOT}\Lib\\${SDK_VER}\ucrt\x64;${SDK_ROOT}\Lib\\${SDK_VER}\um\x64"
  export PATH="$(cygpath -u "$MSVC_DIR")/bin/Hostx64/x64:$PATH"
  export CC="${MSVC_DIR}\bin\Hostx64\x64\cl.exe"
  export DISTUTILS_USE_SDK=1
else
  echo "[comfy] 未启用 sage（COMFY_SAGE=1 且找到 MSVC 才启用）"
fi
COMFY_WIN="$(cygpath -w "$COMFY_DIR")"
LOG_WIN="$(cygpath -w "$LOG")"
powershell -NoProfile -Command "Start-Process -FilePath '$COMFY_WIN\python_embeded\python.exe' -ArgumentList '-s','ComfyUI/main.py','--windows-standalone-build','--listen','0.0.0.0',${SAGE_ARG}'--enable-cors-header','*' -WorkingDirectory '$COMFY_WIN' -WindowStyle Hidden -RedirectStandardOutput '$LOG_WIN' -RedirectStandardError '$LOG_WIN.err'"

echo "[comfy] 后台启动中，探活 $BASE_URL ..."
for i in $(seq 1 90); do
  if curl -s -o /dev/null --max-time 2 "$BASE_URL/system_stats"; then
    echo "[comfy] 就绪：$BASE_URL （界面用浏览器打开即可）"
    exit 0
  fi
  sleep 2
done

echo "[comfy] 180 秒内未就绪 —— 查看日志：tail -50 logs/comfyui.log logs/comfyui.log.err"
exit 1
