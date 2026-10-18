/**
 * 酒馆三类资产（世界书/预设/正则）导入导出测试（TDD，Task 25）。
 *
 * fixtures 取自酒馆 default/content（Eldoria.json 世界书、presets/openai/Default.json 预设），
 * 正则样本按 extensions/regex 引擎字段手写。
 * ioAssetsRouter 尚未挂入 app.ts（协调者统一挂载），测试自装配最小 express app，
 * DATA_DIR 指向临时目录；multipart 上传经 supertest .attach()。
 * 覆盖：fixture 导入→GET 深比较、位置归一（ANTop/EMTop→before、ANBottom/EMBottom→after）、
 * prompt_order 取 character_id=100001、导出 roundtrip、非法 JSON/非法结构 400、鉴权 401。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { ioAssetsRouter } from '../../routes/library/io-assets';
import { libraryRouter } from '../../routes/library';

// ---------- fixtures（酒馆真实文件，仓库内相对测试文件的路径） ----------

const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));
const FIXTURE_DIR = join(REPO_ROOT, '酒馆代码', 'SillyTavern', 'default', 'content');

const eldoriaRaw: unknown = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'Eldoria.json'), 'utf8'),
);
const defaultPresetRaw: unknown = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'presets', 'openai', 'Default.json'), 'utf8'),
);

// ---------- 测试装置 ----------

let root = '';

const authed = (): { Cookie: string } => ({ Cookie: `token=${signToken()}` });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * 挂载路径与协调者一致：libraryRouter.use('/io-assets', ioAssetsRouter) 且 app.use('/api', libraryRouter)，
 * strip 后 ioAssetsRouter 收到的子路径不含 /io-assets 前缀，故此处直接挂 '/api/io-assets' 同语义。
 * 另挂 libraryRouter 供资产读取走标准 CRUD GET（/api/worldbooks/:id 等）。
 */
function makeApp(): Express {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api/io-assets', ioAssetsRouter);
  app.use('/api', libraryRouter);
  app.use(errorHandler);
  return app;
}

interface AssetResponse {
  id: string;
  name: string;
  raw: unknown;
}

/** multipart 导入辅助：content 为字符串 JSON */
function importJson(
  segment: string,
  content: string,
  filename = 'sample.json',
): Promise<SupertestResponse> {
  return request(makeApp())
    .post(`/api/io-assets/${segment}/import`)
    .set(authed())
    .attach('file', Buffer.from(content, 'utf8'), { filename, contentType: 'application/json' });
}

/** 导入并返回资产体（断言 201） */
async function importOk(segment: string, content: string, filename?: string): Promise<AssetResponse> {
  const res = await importJson(segment, content, filename);
  expect(res.status).toBe(201);
  return res.body as AssetResponse;
}

/** 导出辅助：POST /export {id} → 文本体 */
async function exportRaw(segment: string, id: string): Promise<SupertestResponse> {
  return request(makeApp())
    .post(`/api/io-assets/${segment}/export`)
    .set(authed())
    .send({ id });
}

/** 导出后解析回 JSON */
async function exportParsed(segment: string, id: string): Promise<unknown> {
  const res = await exportRaw(segment, id);
  expect(res.status).toBe(200);
  return JSON.parse(res.text) as unknown;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-tavern-io-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

// ---------- 世界书：fixture roundtrip ----------

describe('世界书导入导出（Eldoria fixture）', () => {
  it('导入 Eldoria.json → GET 资产 → raw 全字段深比较无丢失，name 取文件名', async () => {
    const asset = await importOk('worldbooks', JSON.stringify(eldoriaRaw), 'Eldoria.json');
    expect(asset.id).toMatch(UUID_RE);
    expect(asset.name).toBe('Eldoria');
    // 资产读取走 Task 6 标准 CRUD 路由（io-assets 与 CRUD 共用 libraryDir 目录约定）
    const res = await request(makeApp()).get(`/api/worldbooks/${asset.id}`).set(authed());
    expect(res.status).toBe(200);
    // Eldoria 条目 position 全 0/1，无归一化改动 → 与原文件全等
    expect(res.body.raw).toEqual(eldoriaRaw);
  });

  it('导出 → raw JSON 下载 → 与导入后的 raw 深比较（归一后保真）', async () => {
    const asset = await importOk('worldbooks', JSON.stringify(eldoriaRaw), 'Eldoria.json');
    const res = await exportRaw('worldbooks', asset.id);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const exported = JSON.parse(res.text) as unknown;
    expect(exported).toEqual(asset.raw);
    expect(exported).toEqual(eldoriaRaw);
  });
});

// ---------- 位置归一化（设计 §5.2：ANTop/EMTop→before、ANBottom/EMBottom→after） ----------

describe('世界书位置归一化', () => {
  /** position 0..6 各一条 + 顶层附加字段（验证归一化不动其余字段） */
  const book = {
    name: '位置样本',
    originalMeta: { keep: true },
    entries: Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map((p) => [
        String(p),
        { uid: p, key: [`k${p}`], content: `内容${p}`, position: p, order: 100 - p },
      ]),
    ),
  };

  it('position 2/5 → 0（before），3/6 → 1（after），0/1/4 保留', async () => {
    const asset = await importOk('worldbooks', JSON.stringify(book), '位置样本.json');
    const entries = (asset.raw as { entries: Record<string, { position: number }> }).entries;
    expect(entries['2']?.position).toBe(0); // ANTop → before
    expect(entries['5']?.position).toBe(0); // EMTop → before
    expect(entries['3']?.position).toBe(1); // ANBottom → after
    expect(entries['6']?.position).toBe(1); // EMBottom → after
    expect(entries['0']?.position).toBe(0); // before 原样
    expect(entries['1']?.position).toBe(1); // after 原样
    expect(entries['4']?.position).toBe(4); // atDepth 原样（深度注入通道）
  });

  it('归一化仅动 position：条目其余字段与顶层未知字段 passthrough 保留，导出一致', async () => {
    const asset = await importOk('worldbooks', JSON.stringify(book), '位置样本.json');
    const raw = asset.raw as {
      name?: unknown;
      originalMeta?: unknown;
      entries: Record<string, Record<string, unknown>>;
    };
    expect(raw.name).toBe('位置样本');
    expect(raw.originalMeta).toEqual({ keep: true });
    expect(raw.entries['2']).toMatchObject({ uid: 2, key: ['k2'], content: '内容2', order: 98 });
    const exported = (await exportParsed('worldbooks', asset.id)) as typeof raw;
    expect(exported.entries['5']?.position).toBe(0);
    expect(exported.entries['6']?.position).toBe(1);
    expect(exported.originalMeta).toEqual({ keep: true });
  });
});

// ---------- 预设：prompt_order 规范化（设计 §4.7） ----------

describe('预设导入导出（Default.json fixture）', () => {
  it('导入 Default.json → prompt_order 只剩 character_id=100001 一条，其余字段保真', async () => {
    const asset = await importOk('presets', JSON.stringify(defaultPresetRaw), 'Default.json');
    expect(asset.name).toBe('Default'); // Default.json 无顶层 name → 取文件名
    const raw = asset.raw as {
      prompts: unknown[];
      prompt_order: Array<{ character_id: number; order: Array<{ identifier: string }> }>;
      temperature: unknown;
      wi_format: unknown;
    };
    expect(raw.prompt_order).toHaveLength(1);
    expect(raw.prompt_order[0]?.character_id).toBe(100001);
    // 100001 排序列表内容原样保留
    const orig100001 = (
      defaultPresetRaw as { prompt_order: Array<{ character_id: number; order: unknown[] }> }
    ).prompt_order.find((o) => o.character_id === 100001);
    expect(raw.prompt_order[0]?.order).toEqual(orig100001?.order);
    // 100000 那条被丢弃
    expect(JSON.stringify(raw.prompt_order)).not.toContain('100000');
    // prompts 与采样参数等其余字段保真
    expect(raw.prompts).toEqual((defaultPresetRaw as { prompts: unknown[] }).prompts);
    expect(raw.temperature).toEqual((defaultPresetRaw as { temperature: unknown }).temperature);
  });

  it('预设导出 → 与导入归一后的 raw 深比较（roundtrip）', async () => {
    const asset = await importOk('presets', JSON.stringify(defaultPresetRaw), 'Default.json');
    const exported = await exportParsed('presets', asset.id);
    expect(exported).toEqual(asset.raw);
    const raw = exported as { prompt_order: Array<{ character_id: number }> };
    expect(raw.prompt_order).toHaveLength(1);
    expect(raw.prompt_order[0]?.character_id).toBe(100001);
  });

  it('只有 character_id=100000（text completion 排序）→ 400 人话错误', async () => {
    const body = {
      prompts: [{ identifier: 'main', content: 'x' }],
      prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }],
    };
    const res = await importJson('presets', JSON.stringify(body), '孤儿预设.json');
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('chat completion');
  });

  it('无 100001 但仅一条非 text completion 排序列表 → 宽容取用该条', async () => {
    // 社区工具导出常见丢 dummy 标记：唯一排序且非 100000（text completion 专用）时宽容取用
    const body = {
      prompts: [{ identifier: 'main', content: 'x' }],
      prompt_order: [{ character_id: 12345, order: [{ identifier: 'chatHistory', enabled: true }] }],
    };
    const asset = await importOk('presets', JSON.stringify(body), '单条排序.json');
    const raw = asset.raw as {
      prompt_order: Array<{ character_id: number; order: Array<{ identifier: string }> }>;
    };
    expect(raw.prompt_order).toHaveLength(1);
    expect(raw.prompt_order[0]?.order).toEqual([{ identifier: 'chatHistory', enabled: true }]);
  });
});

// ---------- 正则脚本：手写样本 roundtrip ----------

describe('正则脚本导入导出', () => {
  /** 按 extensions/regex 引擎字段手写样本，含未知扩展字段验证保真 */
  const regexJson = {
    id: 'regex-001',
    scriptName: '状态栏美化',
    findRegex: '/<status>([\\s\\S]*?)<\\/status>/g',
    replaceString: '<details>$1</details>',
    trimStrings: ['  ', '\\n'],
    placement: [1, 2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    some_future_field: { nested: true },
  };

  it('导入 → GET → raw 全字段保真（含未知字段），name 取 scriptName', async () => {
    const asset = await importOk('regex-scripts', JSON.stringify(regexJson), '状态栏美化.json');
    expect(asset.name).toBe('状态栏美化');
    // 资产读取走 Task 6 标准 CRUD 路由
    const res = await request(makeApp()).get(`/api/regex-scripts/${asset.id}`).set(authed());
    expect(res.status).toBe(200);
    expect(res.body.raw).toEqual(regexJson);
  });

  it('导出 → raw 与导入原样深比较（roundtrip 无丢失）', async () => {
    const asset = await importOk('regex-scripts', JSON.stringify(regexJson), '状态栏美化.json');
    const exported = await exportParsed('regex-scripts', asset.id);
    expect(exported).toEqual(regexJson);
  });

  it('正则结构不符 → 400 人话错误', async () => {
    const res = await importJson('regex-scripts', JSON.stringify({ foo: 1 }), '坏正则.json');
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('正则');
  });
});

// ---------- 校验、鉴权与上传边界 ----------

describe('校验、鉴权与上传边界', () => {
  it('非法 JSON 内容 → 400 人话错误', async () => {
    const res = await importJson('worldbooks', '{ 这不是 JSON ', 'broken.json');
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('JSON');
  });

  it('multipart 上传非 JSON 文件（text/plain）→ 400', async () => {
    const res = await request(makeApp())
      .post('/api/io-assets/worldbooks/import')
      .set(authed())
      .attach('file', Buffer.from('纯文本内容，不是 JSON', 'utf8'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('JSON');
  });

  it('合法 JSON 但不是世界书结构 → 400 指明世界书不合法', async () => {
    const res = await importJson('worldbooks', JSON.stringify({ foo: 1 }), '不是世界书.json');
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('世界书');
  });

  it('未登录上传 → 401；未登录导出 → 401', async () => {
    const noAuth = request(makeApp());
    const up = await noAuth
      .post('/api/io-assets/worldbooks/import')
      .attach('file', Buffer.from('{}'), { filename: 'x.json' });
    expect(up.status).toBe(401);
    const down = await request(makeApp())
      .post('/api/io-assets/worldbooks/export')
      .send({ id: 'whatever' });
    expect(down.status).toBe(401);
  });

  it('导出不存在的 id → 404；导出 body 缺 id → 400；导入缺文件 → 400', async () => {
    const miss = await exportRaw('presets', '00000000-0000-4000-8000-000000000000');
    expect(miss.status).toBe(404);
    const noId = await request(makeApp())
      .post('/api/io-assets/presets/export')
      .set(authed())
      .send({});
    expect(noId.status).toBe(400);
    const noFile = await request(makeApp())
      .post('/api/io-assets/worldbooks/import')
      .set(authed());
    expect(noFile.status).toBe(400);
  });
});
