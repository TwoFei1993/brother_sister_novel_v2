/**
 * library 路由测试（TDD，Task 6）：四类资产 CRUD。
 *
 * libraryRouter 尚未挂入 app.ts（由协调者统一挂载），测试自装配最小 express app，
 * DATA_DIR 指向 os.tmpdir() 随机临时目录（libraryDir 每请求求值 env，注入即可生效），
 * 鉴权用 signToken 直签 cookie。覆盖：每资源 POST→GET roundtrip、list、PATCH 合并、
 * DELETE 后 404、非法 body 400、strict 壳拒未知字段、raw passthrough 保字段、
 * characters 与 worldbooks 落不同目录。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { libraryRouter } from '../../routes/library';

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

/** 独立装配：libraryRouter 挂 /api + 错误处理，不起真实端口 */
function makeApp(): Express {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api', libraryRouter);
  app.use(errorHandler);
  return app;
}

// ---------- 资源样本（满足 shared schema 的最小合法体） ----------

const characterBody = {
  name: '妹妹',
  card: {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: '妹妹', description: '测试角色', first_mes: '你好呀' },
  },
};

const worldbookBody = {
  name: '魔法世界书',
  raw: {
    entries: { '0': { uid: 0, key: ['魔法'], content: '这个世界存在魔法' } },
  },
};

const presetBody = {
  name: '测试预设',
  raw: {
    prompts: [
      { identifier: 'main', name: 'Main', role: 'system', content: 'You are a novelist.', marker: false },
    ],
    temperature: 0.7,
  },
};

const regexBody = {
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

// ---------- 鉴权 ----------

describe('鉴权边界', () => {
  it('未带登录态访问资产列表 → 401', async () => {
    const res = await request(makeApp()).get('/api/characters');
    expect(res.status).toBe(401);
  });
});

// ---------- 角色卡 ----------

describe('POST/GET /api/characters', () => {
  it('POST 创建 → 201 + 服务端生成 uuid id', async () => {
    const res = await request(makeApp())
      .post('/api/characters')
      .set(authed())
      .send(characterBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(UUID_RE);
    expect(res.body.name).toBe('妹妹');
    expect(res.body.card.data.name).toBe('妹妹');
  });

  it('POST 携带客户端伪造 id → 400（id 由服务端独占生成）', async () => {
    const res = await request(makeApp())
      .post('/api/characters')
      .set(authed())
      .send({ ...characterBody, id: 'client-forged-id' });
    expect(res.status).toBe(400);
  });

  it('POST 后 GET :id roundtrip：card 全量原样', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/characters').set(authed()).send(characterBody);
    const res: SupertestResponse = await request(app)
      .get(`/api/characters/${created.body.id}`)
      .set(authed());
    expect(res.status).toBe(200);
    expect(res.body.card).toEqual(characterBody.card);
  });

  it('GET / 列表：浅结构 {id,name,createdAt}，包含新建项', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/characters').set(authed()).send(characterBody);
    const res = await request(app).get('/api/characters').set(authed());
    expect(res.status).toBe(200);
    const hit = (res.body as Array<{ id: string; name: string; createdAt?: number }>).find(
      (x) => x.id === created.body.id,
    );
    // POST 服务端盖章 createdAt；列表回传（新资产必有）
    expect(hit).toMatchObject({ id: created.body.id, name: '妹妹' });
    expect(typeof hit?.createdAt).toBe('number');
  });

  it('GET 不存在的 id → 404', async () => {
    const res = await request(makeApp())
      .get('/api/characters/00000000-0000-4000-8000-000000000000')
      .set(authed());
    expect(res.status).toBe(404);
  });
});

describe('PATCH/DELETE /api/characters/:id', () => {
  it('PATCH name → 合并更新：name 变更且 card 原样保留', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/characters').set(authed()).send(characterBody);
    const res = await request(app)
      .patch(`/api/characters/${created.body.id}`)
      .set(authed())
      .send({ name: '改名后的妹妹' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('改名后的妹妹');
    expect(res.body.card).toEqual(characterBody.card);
  });

  it('PATCH 不存在的 id → 404', async () => {
    const res = await request(makeApp())
      .patch('/api/characters/00000000-0000-4000-8000-000000000000')
      .set(authed())
      .send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  it('DELETE → 204，随后 GET → 404', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/characters').set(authed()).send(characterBody);
    const del = await request(app).delete(`/api/characters/${created.body.id}`).set(authed());
    expect(del.status).toBe(204);
    const res = await request(app).get(`/api/characters/${created.body.id}`).set(authed());
    expect(res.status).toBe(404);
  });
});

// ---------- 世界书 ----------

describe('POST/GET/PATCH/DELETE /api/worldbooks', () => {
  it('POST 创建 → GET roundtrip：entries 原样', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/worldbooks').set(authed()).send(worldbookBody);
    expect(created.status).toBe(201);
    const res = await request(app).get(`/api/worldbooks/${created.body.id}`).set(authed());
    expect(res.status).toBe(200);
    expect(res.body.raw).toEqual(worldbookBody.raw);
    expect(res.body.name).toBe('魔法世界书');
  });

  it('GET / 列表包含新建世界书', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/worldbooks').set(authed()).send(worldbookBody);
    const res = await request(app).get('/api/worldbooks').set(authed());
    expect((res.body as Array<{ id: string; name: string }>).map((x) => x.id)).toContain(
      created.body.id,
    );
  });

  it('PATCH name → 合并更新且 raw 原样', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/worldbooks').set(authed()).send(worldbookBody);
    const res = await request(app)
      .patch(`/api/worldbooks/${created.body.id}`)
      .set(authed())
      .send({ name: '改名世界书' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('改名世界书');
    expect(res.body.raw).toEqual(worldbookBody.raw);
  });

  it('DELETE 后 GET → 404', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/worldbooks').set(authed()).send(worldbookBody);
    await request(app).delete(`/api/worldbooks/${created.body.id}`).set(authed());
    const res = await request(app).get(`/api/worldbooks/${created.body.id}`).set(authed());
    expect(res.status).toBe(404);
  });

  it('POST raw 缺 entries → 400', async () => {
    const res = await request(makeApp())
      .post('/api/worldbooks')
      .set(authed())
      .send({ name: '坏世界书', raw: { foo: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

// ---------- 预设 ----------

describe('POST/GET/PATCH/DELETE /api/presets', () => {
  it('POST 创建 → GET roundtrip：prompts 与采样参数原样', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/presets').set(authed()).send(presetBody);
    expect(created.status).toBe(201);
    const res = await request(app).get(`/api/presets/${created.body.id}`).set(authed());
    expect(res.status).toBe(200);
    expect(res.body.raw).toEqual(presetBody.raw);
  });

  it('raw 中酒馆未知字段 passthrough 保留（roundtrip 不丢数据）', async () => {
    const app = makeApp();
    const body = {
      name: '带扩展字段的预设',
      raw: { ...presetBody.raw, some_future_tavern_field: { nested: true } },
    };
    const created = await request(app).post('/api/presets').set(authed()).send(body);
    const res = await request(app).get(`/api/presets/${created.body.id}`).set(authed());
    expect(res.body.raw.some_future_tavern_field).toEqual({ nested: true });
  });

  it('PATCH name → 合并更新', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/presets').set(authed()).send(presetBody);
    const res = await request(app)
      .patch(`/api/presets/${created.body.id}`)
      .set(authed())
      .send({ name: '改名预设' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('改名预设');
  });

  it('DELETE 后 GET → 404', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/presets').set(authed()).send(presetBody);
    await request(app).delete(`/api/presets/${created.body.id}`).set(authed());
    const res = await request(app).get(`/api/presets/${created.body.id}`).set(authed());
    expect(res.status).toBe(404);
  });
});

// ---------- 正则脚本 ----------

describe('POST/GET/DELETE /api/regex-scripts', () => {
  it('POST 创建 → GET roundtrip：raw 原样', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/regex-scripts').set(authed()).send(regexBody);
    expect(created.status).toBe(201);
    const res = await request(app).get(`/api/regex-scripts/${created.body.id}`).set(authed());
    expect(res.status).toBe(200);
    expect(res.body.raw).toEqual(regexBody.raw);
  });

  it('PATCH name → 合并更新', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/regex-scripts').set(authed()).send(regexBody);
    const res = await request(app)
      .patch(`/api/regex-scripts/${created.body.id}`)
      .set(authed())
      .send({ name: '改名正则' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('改名正则');
  });

  it('DELETE 后 GET → 404', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/regex-scripts').set(authed()).send(regexBody);
    await request(app).delete(`/api/regex-scripts/${created.body.id}`).set(authed());
    const res = await request(app).get(`/api/regex-scripts/${created.body.id}`).set(authed());
    expect(res.status).toBe(404);
  });
});

// ---------- 校验与隔离 ----------

describe('校验与目录隔离', () => {
  it('POST 角色卡缺 card → 400', async () => {
    const res = await request(makeApp())
      .post('/api/characters')
      .set(authed())
      .send({ name: '没卡的' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('POST 壳层未知字段 → 400（strict 壳，与 raw 的 passthrough 相区分）', async () => {
    const res = await request(makeApp())
      .post('/api/characters')
      .set(authed())
      .send({ ...characterBody, not_a_shell_field: 1 });
    expect(res.status).toBe(400);
  });

  it('characters 与 worldbooks 数据落不同目录（data/characters 与 data/worldbooks）', async () => {
    const app = makeApp();
    const c = await request(app).post('/api/characters').set(authed()).send(characterBody);
    const w = await request(app).post('/api/worldbooks').set(authed()).send(worldbookBody);
    await expect(stat(join(root, 'characters', `${c.body.id}.json`))).resolves.toBeTruthy();
    await expect(stat(join(root, 'worldbooks', `${w.body.id}.json`))).resolves.toBeTruthy();
    const characterFiles = await readdir(join(root, 'characters'));
    expect(characterFiles).not.toContain(`${w.body.id}.json`);
  });
});
