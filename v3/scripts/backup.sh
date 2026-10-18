#!/usr/bin/env bash
# 数据备份：将 data/ 打包为 backups/backup-<时间戳>.tar.gz
# 恢复方式：tar -xzf backups/backup-<时间戳>.tar.gz（在 v3/ 根目录下执行）
# 用法：bash scripts/backup.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# data/ 不存在则先初始化空目录，保证备份始终可产出
mkdir -p backups data

stamp="$(date +%Y%m%d-%H%M%S)"
out="backups/backup-${stamp}.tar.gz"

tar -czf "$out" data
echo "[backup] 已生成 ${out}"
