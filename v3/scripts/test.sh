#!/usr/bin/env bash
# 全 workspace 测试：各子包的 test 脚本（vitest run）
# 尚无测试的包自动跳过（--if-present），后续任务接入 vitest 后自动生效
# 用法：bash scripts/test.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[test] 运行全部子包测试 ..."
pnpm -r --if-present test

echo "[test] 全部通过"
