#!/usr/bin/env bash
# 三新功能真实验证（建议题/自由调整/物品清单）：跑一轮真实向导对话并逐轮断言
# 用法：bash scripts/verify-planner.sh   （需 dev server :3001 运行中）
set -euo pipefail
cd "$(dirname "$0")/.."
export ACCESS_PASSWORD="${ACCESS_PASSWORD:-dev123}"
# --filter exec 的 CWD 在 server 子包 → 脚本必须传绝对路径
pnpm --filter @v3/server exec tsx "$(pwd)/scripts/verify-planner-features.mts"
