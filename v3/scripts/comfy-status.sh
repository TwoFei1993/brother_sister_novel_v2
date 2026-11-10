#!/usr/bin/env bash
# 探活本地 ComfyUI：打印系统状态摘要（显存/内存）与就绪结论
# 用法：bash scripts/comfy-status.sh
set -euo pipefail

BASE_URL="${COMFY_URL:-http://127.0.0.1:8188}"

BODY=$(curl -s --max-time 3 "$BASE_URL/system_stats" || true)
if [ -z "$BODY" ]; then
  echo "[comfy] 未运行（$BASE_URL 无响应）—— 启动：bash scripts/comfy-start.sh"
  exit 1
fi

echo "[comfy] 运行中：$BASE_URL"
echo "$BODY" | head -c 600
echo ""
