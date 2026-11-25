#!/usr/bin/env bash
# 提示词探针（零 LLM 成本）：为某本书的下一章组装最终提示词，检查关键词是否真的在里面。
# 用法：bash scripts/probe-prompt.sh <workId> [关键词1] [关键词2] ...
#       关键词全部命中退出码 0；有未命中退出码 2（可用于验收脚本）
# 必须在 server 目录下跑：tsx 读 server/tsconfig.json 的 @shared/* 路径别名
set -euo pipefail

cd "$(dirname "$0")/../server"
exec pnpm exec tsx ../scripts/probe-prompt.mts "$@"
