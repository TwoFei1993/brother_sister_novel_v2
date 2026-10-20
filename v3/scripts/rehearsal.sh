#!/usr/bin/env bash
# 上线前 Docker 演练一键脚本：构建镜像 → 起服务 → API 冒烟 → 重启容器 → 持久化验证
#
# 用法：bash scripts/rehearsal.sh          # 全流程（构建 + 起停 + 两阶段冒烟）
#       bash scripts/rehearsal.sh down     # 停服并保留数据卷
#       bash scripts/rehearsal.sh clean    # 停服并清空数据卷（彻底重置演练环境）
# 环境：ACCESS_PASSWORD（默认 rehearsal123）；入口 http://localhost:3011
set -euo pipefail

cd "$(dirname "$0")/.."
export ACCESS_PASSWORD="${ACCESS_PASSWORD:-rehearsal123}"

compose() { docker compose -f docker-compose.yml "$@"; }

wait_health() {
  echo "[rehearsal] 等待 health ..."
  for _ in $(seq 1 60); do
    if curl -sf "http://localhost:3011/api/health" >/dev/null 2>&1; then
      echo "[rehearsal] health OK"
      return 0
    fi
    sleep 2
  done
  echo "[rehearsal] health 超时（120s）"; exit 1
}

case "${1:-full}" in
  down)
    compose down
    echo "[rehearsal] 已停止（数据卷保留；彻底重置请用 clean）"
    ;;
  clean)
    compose down -v
    echo "[rehearsal] 已停止并清空数据卷"
    ;;
  *)
    echo "[rehearsal] 1/5 构建镜像 ..."
    compose build

    echo "[rehearsal] 2/5 启动服务（app + mock 上游）..."
    compose up -d
    wait_health

    echo "[rehearsal] 3/5 phase1 冒烟（登录/密钥/建作品/生成/入库）..."
    node scripts/rehearsal-smoke.mjs phase1

    echo "[rehearsal] 4/5 重启容器验证持久化 ..."
    compose restart app
    wait_health

    echo "[rehearsal] 5/5 phase2 冒烟（重启后数据仍在）..."
    node scripts/rehearsal-smoke.mjs phase2

    echo ""
    echo "[rehearsal] ✅ 演练完成。入口 http://localhost:3011（密码 ${ACCESS_PASSWORD}）"
    echo "[rehearsal]    停止：bash scripts/rehearsal.sh down ｜ 彻底重置：clean"
    ;;
esac
