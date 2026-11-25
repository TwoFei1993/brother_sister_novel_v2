#!/usr/bin/env bash
# 只启动前端开发服务（:5173，/api 代理到已在运行的 :3001 后端）——
# 适用：后端已经由别的终端/会话启动、只需验证前端改动时；前后端都要起请用 dev.sh
# 用法：bash scripts/dev-client.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if ! curl -s -o /dev/null --max-time 3 http://localhost:3001/api/ping; then
  echo "[dev-client] 后端 :3001 未响应——请先 bash scripts/dev.sh（或单独启动 server）"
  exit 1
fi

echo "[dev-client] 前端 → http://localhost:5173 （/api 代理到 3001）"
pnpm --filter @v3/client dev --host 127.0.0.1
