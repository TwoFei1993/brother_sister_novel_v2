/**
 * 服务端启动入口：读环境变量 → 装配 app → 监听
 *
 * env：
 * - PORT            监听端口（默认 3001）
 * - ACCESS_PASSWORD 登录密码（必配；未配置时登录接口返回 503 并告警）
 * - DATA_DIR        数据目录（默认 ../data，相对 server/ 解析为绝对路径）
 * - AUTH_SECRET     token 密钥（可选；多实例部署需固定，单实例随机即可）
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app';
import { logger } from './middleware/logger';
import { migrateMessageVersions } from './services/message-migrate';

// server/ 目录（main.ts 位于 src/ 下，上一级即 server/）
const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));

const port = Number(process.env.PORT ?? 3001);
const dataDir = resolve(SERVER_ROOT, process.env.DATA_DIR ?? '../data');

if (!process.env.ACCESS_PASSWORD) {
  logger.warn('未设置 ACCESS_PASSWORD：登录接口将返回 503，请配置环境变量后重启');
}
mkdirSync(dataDir, { recursive: true });

// 存量 swipes → 结构化版本（幂等，无旧数据时零写回）；失败仅告警不阻断启动（读取路径宽松，可下次再迁）
migrateMessageVersions(dataDir)
  .catch((err) => logger.warn(`消息版本迁移失败（不影响启动，重启可重试）：${String(err)}`))
  .finally(() => {
    createApp().listen(port, () => {
      logger.info(`服务已启动 http://localhost:${port}（数据目录：${dataDir}）`);
    });
  });
