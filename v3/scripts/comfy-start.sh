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
COMFY_WIN="$(cygpath -w "$COMFY_DIR")"
LOG_WIN="$(cygpath -w "$LOG")"
powershell -NoProfile -Command "Start-Process -FilePath '$COMFY_WIN\python_embeded\python.exe' -ArgumentList '-s','ComfyUI/main.py','--windows-standalone-build','--listen','0.0.0.0','--enable-cors-header','*' -WorkingDirectory '$COMFY_WIN' -WindowStyle Hidden -RedirectStandardOutput '$LOG_WIN' -RedirectStandardError '$LOG_WIN.err'"

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
