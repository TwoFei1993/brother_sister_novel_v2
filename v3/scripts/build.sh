#!/usr/bin/env bash
# 全量构建：
#   server → tsc 产物 dist/（类型校验 + 产物）
#   client → vite build 产物 server/public/（生产由 server 同源托管）
# 用法：bash scripts/build.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[build] 递归构建全部子包 ..."
pnpm -r build

echo "[build] 完成：server/dist（tsc 校验产物）+ server/public（客户端静态资源）"
