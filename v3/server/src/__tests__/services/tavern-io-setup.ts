/**
 * 酒馆资产导入导出测试共享装置（tavern-io.test.ts / tavern-io-regex.test.ts 共用）
 *
 * fixtures 取自酒馆 default/content（Eldoria.json 世界书、Default.json 预设）；
 * ioAssetsRouter 自装配挂 /api/io（strip 后子路径不含 /io 前缀，同协调者挂载语义），
 * DATA_DIR 指向临时目录；multipart 上传经 supertest .attach()。
 */
import { afterAll, beforeAll, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { ZodError } from 'zod';

import { signToken } from '../../middleware/auth';
import { HttpError } from '../../middleware/validate';
import { ioAssetsRouter } from '../../routes/library/io/io-assets';
import { libraryRouter } from '../../routes/library';

// ---------- fixtures（酒馆真实文件，仓库内相对测试文件的路径） ----------

const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));
const FIXTURE_DIR = join(REPO_ROOT, '酒馆代码', 'SillyTavern', 'default', 'content');

export const eldoriaRaw: unknown = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'Eldoria.json'), 'utf8'),
);
export const defaultPresetRaw: unknown = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'presets', 'openai', 'Default.json'), 'utf8'),
);

// ---------- 测试装置 ----------

export const authed = (): { Cookie: string } => ({ Cookie: `token=${signToken()}` });

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 与 app.ts 同语义的最小错误处理（HttpError→状态码，ZodError→400，其余→500） */
function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
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

/**
 * 独立装配 + 错误处理，不起真实端口。
 * 另挂 libraryRouter 供资产读取走标准 CRUD GET（/api/worldbooks/:id 等）。
 */
export function makeApp(): Express {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/io', ioAssetsRouter);
  app.use('/api', libraryRouter);
  app.use(errorHandler);
  return app;
}

export interface AssetResponse {
  id: string;
  name: string;
  raw: unknown;
}

/** multipart 导入辅助：content 为字符串 JSON */
export function importJson(
  segment: string,
  content: string,
  filename = 'sample.json',
): Promise<SupertestResponse> {
  return request(makeApp())
    .post(`/api/io/${segment}/import`)
    .set(authed())
    .attach('file', Buffer.from(content, 'utf8'), { filename, contentType: 'application/json' });
}

/** 导入并返回资产体（断言 201） */
export async function importOk(segment: string, content: string, filename?: string): Promise<AssetResponse> {
  const res = await importJson(segment, content, filename);
  expect(res.status).toBe(201);
  return res.body as AssetResponse;
}

/** 导出辅助：POST /export {id} → 文本体 */
export async function exportRaw(segment: string, id: string): Promise<SupertestResponse> {
  return request(makeApp())
    .post(`/api/io/${segment}/export`)
    .set(authed())
    .send({ id });
}

/** 导出后解析回 JSON */
export async function exportParsed(segment: string, id: string): Promise<unknown> {
  const res = await exportRaw(segment, id);
  expect(res.status).toBe(200);
  return JSON.parse(res.text) as unknown;
}

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-tavern-io-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  await rm(root, { recursive: true, force: true });
});
