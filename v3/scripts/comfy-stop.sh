#!/usr/bin/env bash
# 停止本地 ComfyUI 服务（按 8188 端口监听进程定位，手动 bat 启动的也能停）
# 用法：bash scripts/comfy-stop.sh
set -euo pipefail

PID=$(netstat -ano | grep ':8188' | grep 'LISTENING' | awk '{print $NF}' | head -1 || true)

if [ -z "$PID" ]; then
  echo "[comfy] 未发现运行中的 ComfyUI（8188 无监听）"
  exit 0
fi

echo "[comfy] 停止 ComfyUI（PID $PID）"
taskkill //F //PID "$PID"
echo "[comfy] 已停止"
