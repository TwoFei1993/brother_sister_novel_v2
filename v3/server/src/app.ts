/**
 * Express 应用装配（工厂函数，supertest 与 main.ts 共用）
 *
 * 中间件顺序：请求日志 → JSON 解析(50mb) → 静态托管(存在时)
 * → 探活 → API 路由组 → 404 → 统一错误处理（zod/HttpError→400，其余→500 人话）
 */
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import multer from 'multer';
import { ZodError } from 'zod';

import { httpLogger, logger } from './middleware/logger';
import { HttpError, formatZodError } from './middleware/validate';
import { coreRouter } from './routes/core';
import { dataDir } from './routes/core/paths';
import { extractRouter } from './routes/extract';
import { libraryRouter } from './routes/library';
import { llmRouter } from './routes/llm';
import { worksRouter } from './routes/works';

// client 构建产物目录（scripts/build.sh 产出；开发期不存在则跳过托管）
const PUBLIC_DIR =
  process.env.PUBLIC_DIR ?? resolve(fileURLToPath(new URL('../public/', import.meta.url)));

/** 404 兜底：API 与静态资源都未命中 */
function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: '接口不存在' });
}

/** 统一错误处理：zod/HttpError → 400 人话；坏 JSON → 400；未知 → 500（细节进日志） */
function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: `请求不合法：${formatZodError(err)}` });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof SyntaxError && (err as { status?: number }).status === 400) {
    res.status(400).json({ error: '请求体不是合法 JSON' });
    return;
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: '文件超过大小限制' }); // 上传超限是客户端问题，非 500（review #8）
    return;
  }
  logger.error({ err }, '未处理异常');
  res.status(500).json({ error: '服务器内部错误，请查看服务端日志' });
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // 反代（caddy/nginx）后识别 X-Forwarded-Proto，使 req.secure/cookie Secure 判定正确
  app.set('trust proxy', 1);
  app.use(httpLogger);
  app.use(express.json({ limit: '50mb' }));

  // 角色卡头像静态托管（CardEditor 直接以 /data-assets/<id>.png 引用，无需 API 鉴权）。
  // DATA_DIR 每请求实时读 env（与 libraryDir/dataDir 同约定，测试注入即生效）；
  // handler 按目录惰性缓存，env 变更时重建一次，避免每请求新建 static 实例。
  let avatarStatic: ReturnType<typeof express.static> | null = null;
  let avatarDir = '';
  app.use('/data-assets', (req, res, next) => {
    const dir = resolve(dataDir(), 'characters');
    if (dir !== avatarDir || avatarStatic === null) {
      avatarDir = dir;
      avatarStatic = express.static(dir);
    }
    avatarStatic(req, res, next);
  });

  // 静态托管前端构建产物（构建后存在才挂，开发期跳过避免干扰）
  if (existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));
  }

  // 探活（dev.sh 联动验证用，免鉴权）
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true });
  });

  // API 路由组（设计 §6）
  app.use('/api', coreRouter);
  app.use('/api', libraryRouter); // library/ 角色卡·世界书·预设·正则
  app.use('/api', worksRouter);   // works/ 作品 CRUD + 消息流（messages 子路由 Task 8）
  app.use('/api', llmRouter);     // llm/ 生成代理（SSE）+ 探活 + tokenize（Task 17）
  app.use('/api/extract', extractRouter); // extract/ Word 文档文本提取（向导导入）
  // ---- 后续任务预留挂载位 ----

  // SPA 历史回退：非 API/静态资源且无扩展名的 GET → index.html（react-router 深链接/刷新；
  // 生产构建存在才挂，开发期 Vite dev 自带回退）。带扩展名的资源缺失仍走 404。
  if (existsSync(PUBLIC_DIR)) {
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/data-assets') || extname(req.path)) {
        next();
        return;
      }
      res.sendFile(resolve(PUBLIC_DIR, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
