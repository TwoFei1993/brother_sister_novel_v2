/**
 * 结构化日志：pino 落盘 + pino-http 请求日志
 *
 * 按天滚动采用轻量自轮转（不引 pino-roll：其日期只能作文件后缀，
 * 不满足 `server-YYYYMMDD.log` 命名）：自实现一层 Writable，
 * 每次写入前核对当天日期，跨天自动切换到新文件流，旧流 end() 收尾。
 */
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';

import pino from 'pino';
import { pinoHttp } from 'pino-http';

// v3/logs/（workspace 根，与 data/ 同级；可用 LOG_DIR env 覆盖）
const LOG_DIR =
  process.env.LOG_DIR ?? resolve(fileURLToPath(new URL('../../../logs/', import.meta.url)));

/** 当天日志文件绝对路径：server-YYYYMMDD.log */
function logFileFor(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return resolve(LOG_DIR, `server-${y}${m}${d}.log`);
}

/** 按天切换文件流的 Writable：pino 每行 JSON 均经此落盘 */
function createDailyStream(): Writable {
  let current: WriteStream | null = null;
  let currentDate = '';
  return new Writable({
    write(chunk, _enc, cb) {
      const today = logFileFor(new Date());
      if (today !== currentDate || !current) {
        mkdirSync(LOG_DIR, { recursive: true });
        current?.end();
        current = createWriteStream(today, { flags: 'a' });
        currentDate = today;
      }
      current.write(chunk, cb);
    },
    final(cb) {
      current?.end(cb);
      cb();
    },
  });
}

/** 全局日志实例：文件 + 级别可用 env LOG_DIR / LOG_LEVEL 覆盖 */
export const logger = pino(
  { level: process.env.LOG_LEVEL ?? 'info', timestamp: pino.stdTimeFunctions.isoTime },
  createDailyStream(),
);

/** 请求日志中间件：/api/ping 探活不打日志（dev.sh 轮询噪音） */
export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => (req.url ?? '').startsWith('/api/ping'),
  },
});
