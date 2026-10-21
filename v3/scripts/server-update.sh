#!/usr/bin/env bash
# 服务器自动更新脚本：拉取最新镜像 → 与运行中的对比 → 有更新才重建容器（数据卷不受影响）
#
# 服务器安装（一次性）：
#   sudo mkdir -p /opt/novel && sudo cp scripts/server-update.sh /opt/novel/
#   sudo tee /opt/novel/.env <<'EOF'
#   REGISTRY=ccr.ccs.tencentyun.com/你的命名空间      # 或 ghcr.io/twofei1993（海外慢）
#   ACCESS_PASSWORD=你的登录密码
#   EOF
#   sudo chmod 600 /opt/novel/.env
#   sudo crontab -e   # 加一行：每 10 分钟自动检查更新
#   */10 * * * * /opt/novel/server-update.sh >> /var/log/novel-update.log 2>&1
#
# 首次需 docker login 一次对应仓库（凭证会持久化，之后 cron 免密拉取）
set -euo pipefail

cd /opt/novel
[ -f .env ] && source .env
REGISTRY="${REGISTRY:-ghcr.io/twofei1993}"
IMAGE="$REGISTRY/brother_sister_novel_v2:latest"
CONTAINER="novel-app"

OLD_DIGEST="$(docker inspect --format '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo none)"
echo "[$(date '+%F %T')] 拉取 $IMAGE ..."
if ! docker pull "$IMAGE" >/dev/null 2>&1; then
  echo "[$(date '+%F %T')] 拉取失败（网络/凭证），保留当前版本"
  exit 0
fi
NEW_DIGEST="$(docker inspect --format '{{index .RepoDigests 0}}' "$IMAGE")"

if [ "$NEW_DIGEST" = "$OLD_DIGEST" ]; then
  exit 0   # 无更新，静默退出（避免 cron 刷屏）
fi

echo "[$(date '+%F %T')] 发现新版本 $NEW_DIGEST，重建容器 ..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -p 3001:3001 \
  -e ACCESS_PASSWORD="$ACCESS_PASSWORD" \
  -v novel-data:/app/data -v novel-logs:/app/logs \
  --restart unless-stopped \
  "$IMAGE"
echo "$NEW_DIGEST" > /opt/novel/.last-digest
echo "[$(date '+%F %T')] 更新完成"
