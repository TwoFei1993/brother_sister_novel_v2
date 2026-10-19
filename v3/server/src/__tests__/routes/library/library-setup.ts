/**
 * library 路由测试共享装置（library.test.ts / library-more.test.ts 共用）
 *
 * 自装配最小 express app（libraryRouter 挂 /api + 错误处理）；
 * DATA_DIR 指向 os.tmpdir() 随机临时目录（libraryDir 每请求求值 env，注入即生效）；
 * 鉴权用 signToken 直签 cookie。样本体为满足 shared schema 的最小合法体。
 */
import { afterAll, beforeAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { ZodError } from 'zod';

import { signToken } from '../../../middleware/auth';
import { HttpError } from '../../../middleware/validate';
import { libraryRouter } from '../../../routes/library';

let root = '';

/** 当前测试数据根目录（beforeAll 后有效；目录隔离断言用） */
export function rootPath(): string {
  return root;
}

export const authed = (): { Cookie: string } => ({ Cookie: `token=${signToken()}` });

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 与 app.ts 同语义的最小错误处理（HttpError→状态码，ZodError→400，其余→500） */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: '请求不合法' });
    return;
  }
  res.status(500).json({ error: '服务器内部错误' });
}

/** 独立装配：libraryRouter 挂 /api + 错误处理，不起真实端口 */
export function makeApp(): Express {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api', libraryRouter);
  app.use(errorHandler);
  return app;
}

// ---------- 资源样本（满足 shared schema 的最小合法体） ----------

export const characterBody = {
  name: '妹妹',
  card: {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: '妹妹', description: '测试角色', first_mes: '你好呀' },
  },
};

export const worldbookBody = {
  name: '魔法世界书',
  raw: {
    entries: { '0': { uid: 0, key: ['魔法'], content: '这个世界存在魔法' } },
  },
};

export const presetBody = {
  name: '测试预设',
  raw: {
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', content: 'You are a novelist.', marker: false },
    ],
    temperature: 0.7,
  },
};

export const regexBody = {
  name: '去星号',
  raw: {
    scriptName: '去星号',
    findRegex: '/\\*\\*(.+?)\\*\\*/g',
    replaceString: '$1',
    placement: [2],
    disabled: false,
  },
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-library-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  await rm(root, { recursive: true, force: true });
});
