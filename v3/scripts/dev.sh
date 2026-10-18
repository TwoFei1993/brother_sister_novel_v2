#!/usr/bin/env bash
# 一键启动本地开发环境：server(:3001) + client(:5173)
# 用法：bash scripts/dev.sh   （Ctrl+C 同时退出两个进程）
set -euo pipefail

# 统一切到 v3 根目录（脚本可在任意位置调用）
cd "$(dirname "$0")/.."

# ---- 预检：确保运行时目录存在（内容不入库，仅 .gitkeep 占位）----
mkdir -p data logs
[ -f data/.gitkeep ] || touch data/.gitkeep
[ -f logs/.gitkeep ] || touch logs/.gitkeep

# ---- 依赖检查：首次运行自动安装 ----
if [ ! -d node_modules ]; then
  echo "[dev] 未发现 node_modules，先执行 pnpm install ..."
  pnpm install
fi

# ---- 登录密码：本地默认 dev123（外部已设置则不覆盖；生产部署必须显式配置）----
export ACCESS_PASSWORD="${ACCESS_PASSWORD:-dev123}"

# ---- 并发启动：记录 PID，退出时统一回收 ----
pids=()

echo "[dev] 启动 server → http://localhost:3001"
pnpm --filter @v3/server dev &
pids+=($!)

echo "[dev] 启动 client → http://localhost:5173 （/api 已代理到 3001）"
pnpm --filter @v3/client dev &
pids+=($!)

# Ctrl+C / 终止信号时杀掉全部子进程
cleanup() {
  kill "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[dev] 就绪：前端 http://localhost:5173 ｜ 后端探活 http://localhost:3001/api/ping"
wait
