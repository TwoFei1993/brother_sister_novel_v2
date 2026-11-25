#!/usr/bin/env bash
# 单包测试：分包跑（client 关闭文件并行——pnpm -r 递归跑偶发 tinypool IPC 崩溃，分包最稳）
# 用法：bash scripts/test-pkg.sh client|server|shared [vitest 过滤串...]
#       不带过滤串 = 该包全部单测；三个包全量请用 bash scripts/test.sh
set -euo pipefail

cd "$(dirname "$0")/.."

pkg="${1:?用法: bash scripts/test-pkg.sh client|server|shared [过滤串...]}"
shift

case "$pkg" in
  client)
    pnpm --filter @v3/client exec vitest run --no-file-parallelism "$@"
    ;;
  server|shared)
    pnpm --filter "@v3/$pkg" exec vitest run "$@"
    ;;
  *)
    echo "未知包：$pkg（可选 client / server / shared）"
    exit 1
    ;;
esac
