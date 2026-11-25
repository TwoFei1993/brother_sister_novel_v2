#!/usr/bin/env bash
# 全 workspace 类型检查（不产出构建物，比 build.sh 快）：
#   client（tsc --noEmit）/ server（tsc --noEmit）/ shared（tsc --noEmit）
# 用法：bash scripts/typecheck.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[typecheck] client ..."
pnpm --filter @v3/client typecheck
echo "[typecheck] server ..."
pnpm --filter @v3/server exec tsc --noEmit
echo "[typecheck] shared ..."
pnpm --filter @v3/shared exec tsc --noEmit

echo "[typecheck] 全部通过"
