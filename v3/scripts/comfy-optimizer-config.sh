#!/usr/bin/env bash
# 一键配置 AICG3D 提示词优化器 → MiniMax API（复用 v3/data/secrets.json 的 claude.apiKey，不回显不落盘）
# 前置：ComfyUI 已启动且已装 comfyui-AICG3D 插件（v3/scripts/comfy-start.sh）
# 用法：bash scripts/comfy-optimizer-config.sh   （引擎不在本机时 COMFY_URL=http://x.x.x.x:8188 前缀覆盖）
set -euo pipefail

COMFY_URL="${COMFY_URL:-http://127.0.0.1:8188}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY=$(node -e "console.log(require('$ROOT/data/secrets.json').claude.apiKey)")

if [ -z "$KEY" ]; then
  echo "❌ 未读到 key（$ROOT/data/secrets.json 的 claude.apiKey 为空）"
  exit 1
fi

echo "→ 配置优化器：provider=openai（MiniMax 兼容端点）/ model=MiniMax-M3.1-Flash / 输出语言=English"
# 模型选型实测（2026-11-14）：插件硬编码 max_tokens=2048 会被 M3.1-Flash 的思考段吃光（content 空）——
# 已改已装副本 prompt_optimizer.py 的 max_tokens=16384（两处），M3.1 思考走 reasoning_content 字段不污染正文；
# 备选 MiniMax-M2.5（思考写进 content，依赖 _extract_openai 的 <think> 剥离补丁）；Text-01/abab 已下线
RESP=$(curl -s -X POST "$COMFY_URL/aicg3d/goohai/minimax-h3/prompt-optimizer/config" \
  -H 'Content-Type: application/json' \
  -d "{
    \"mode\": \"api\",
    \"provider\": \"openai\",
    \"api_url\": \"https://api.minimaxi.com/v1\",
    \"api_key\": \"$KEY\",
    \"model\": \"MiniMax-M3.1-Flash\",
    \"protocol\": \"openai\",
    \"output_language\": \"English\"
  }")

echo "← 响应（key 不回显）：${RESP:0:400}"
echo
echo "✅ 完成。记得在 App 设置页「本地引擎」勾选「H3 提示词优化器」开关。"
echo "   验证：生成任意镜头视频时，优化器会先把模板提示词升级为六段式结构。"
