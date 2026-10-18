#!/usr/bin/env bash
# 生产启动入口（供 Zeabur / Docker / 本地生产验证调用）：
#   1. 先全量构建（client 产物输出到 server/public/）
#   2. 以 tsx 直跑 TS 源码启动 server（同源托管 public/ 与 /api）
# 前置环境变量见 docs/部署指南.md（ACCESS_PASSWORD / *_API_KEY / TTS_BASE_URL / DATA_DIR）
# 用法：bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# 生产运行时目录兜底
mkdir -p data logs

echo "[deploy] 执行构建 ..."
bash scripts/build.sh

echo "[deploy] 启动生产 server（端口默认 3001，可用 PORT 覆盖）..."
# 进入 server 包目录再启动：pnpm 将 tsx 装在包级 node_modules，须从该目录解析
cd server
exec node --import tsx src/main.ts
