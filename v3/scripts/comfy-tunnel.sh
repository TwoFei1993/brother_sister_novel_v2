#!/usr/bin/env bash
# 本地 ComfyUI → Cloudflare 快速隧道：给手机 App 一个可直连的 HTTPS 地址
#
# 为什么需要：手机 App（HTTPS 页面）直连 http://笔记本IP:8188 会被混合内容拦截，
# 隧道给 ComfyUI 套一层 https 后手机任意网络（WiFi/蜂窝）都能用，无需同局域网。
#
# 用法：bash scripts/comfy-tunnel.sh
#   前置：ComfyUI 已运行（bash scripts/comfy-start.sh）
#   输出：控制台打印 https://xxxx.trycloudflare.com —— 填进手机 App 设置页 ComfyUI 面板
#   停止：Ctrl+C（地址随之失效，下次启动地址会变）
#
# 固定地址（可选，一次性配置，需域名托管在 Cloudflare）：
#   cloudflared tunnel login
#   cloudflared tunnel create comfyui
#   cloudflared tunnel route dns comfyui comfy.你的域名.com
#   cloudflared tunnel run --url http://127.0.0.1:8188 comfyui
#
# 安全提醒：ComfyUI 无认证——隧道地址泄露 = 任何人可用你的 GPU 出图。
# 快速隧道地址随机性强、用完即关，风险可控；命名隧道建议配 Cloudflare Access 策略。
set -euo pipefail

cd "$(dirname "$0")/.."

COMFY_URL="${COMFY_URL:-http://127.0.0.1:8188}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[tunnel] 未安装 cloudflared —— 安任一："
  echo "  winget install --id Cloudflare.cloudflared"
  echo "  或官网下载 cloudflared-windows-amd64.exe 放进 PATH"
  exit 1
fi

if ! curl -s -o /dev/null --max-time 2 "$COMFY_URL/system_stats"; then
  echo "[tunnel] ComfyUI 未运行 —— 先 bash scripts/comfy-start.sh"
  exit 1
fi

echo "[tunnel] 启动 Cloudflare 快速隧道 → $COMFY_URL"
echo "[tunnel] 启动后找『https://xxxx.trycloudflare.com』那行，填进手机 App 设置页 ComfyUI 面板"
exec cloudflared tunnel --no-autoupdate --url "$COMFY_URL"
