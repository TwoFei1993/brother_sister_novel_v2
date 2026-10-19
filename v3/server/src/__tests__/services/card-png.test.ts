/**
 * 角色卡 PNG 导入导出测试（TDD，Task 24）。
 *
 * 单元层直接用酒馆官方 fixture default_Seraphina.png（含 chara(V2)+ccv3(V3) 双 tEXt）：
 * 提取→写入→再提取 roundtrip 全字段深比较；路由层自装配最小 express app
 *（ioCardRouter + charactersRouter），DATA_DIR 指向临时目录，signToken 直签鉴权。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';
import { ZodError } from 'zod';

import {
  encodePng,
  extractCardData,
  parsePngChunks,
  toInternalCard,
  writeCardData,
} from '../../converters/card-png';
import { ioCardRouter } from '../../routes/library/io/io-card';
import { charactersRouter } from '../../routes/library/characters';
import { signToken } from '../../middleware/auth';
import { HttpError } from '../../middleware/validate';

// ---------- 测试装置 ----------

/** 酒馆官方 fixture：项目根/酒馆代码/SillyTavern/default/content/default_Seraphina.png */
const FIXTURE = fileURLToPath(
  new URL('../../../../../酒馆代码/SillyTavern/default/content/default_Seraphina.png', import.meta.url),
);

const fixtureBuf = (): Buffer => readFileSync(FIXTURE);

const authed = (): { Cookie: string } => ({ Cookie: `token=${signToken()}` });

let root = '';

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

function makeApp(): Express {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  // 与协调者挂载一致：libraryRouter.use('/io', ioCardRouter) 且 app.use('/api', libraryRouter)
  app.use('/api/io', ioCardRouter);
  app.use('/api/characters', charactersRouter);
  app.use(errorHandler);
  return app;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-cardpng-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

// ---------- 转换器单元 ----------

describe('extractCardData', () => {
  it('fixture 提取：ccv3 优先，name=Seraphina', () => {
    const card = extractCardData(fixtureBuf()) as Record<string, unknown>;
    expect(card.spec).toBe('chara_card_v3');
    const data = card.data as Record<string, unknown>;
    expect(data.name).toBe('Seraphina');
  });

  it('只含 chara（V2）的 PNG 也能解', () => {
    const v2 = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: '阿妹', description: '测试', first_mes: '你好' },
    };
    // 任意 PNG 均可作底图：写入双 chunk 后删掉 ccv3 只留 chara，模拟旧版纯 V2 卡
    const full = writeCardData(fixtureBuf(), v2);
    const onlyV2 = encodePng(parsePngChunks(full).filter((c) => c.type !== 'tEXt' || !c.data.includes('ccv3')));
    const card = extractCardData(onlyV2) as Record<string, unknown>;
    expect(card.spec).toBe('chara_card_v2');
    expect((card.data as Record<string, unknown>).name).toBe('阿妹');
  });

  it('无元数据 PNG 抛明确错误（剔除 Seraphina 全部 tEXt）', () => {
    const bare = encodePng(parsePngChunks(fixtureBuf()).filter((c) => c.type !== 'tEXt'));
    expect(() => extractCardData(bare)).toThrow('该 PNG 不含角色卡元数据');
  });
});

describe('writeCardData', () => {
  it('产出仍是合法 PNG：签名正确、chunk 可遍历、IEND 收尾', () => {
    const v2 = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: '合法', description: '', first_mes: '' },
    };
    const out = writeCardData(fixtureBuf(), v2);
    expect(out.subarray(0, 8).toString('latin1')).toBe('\x89PNG\r\n\x1a\n');
    const chunks = parsePngChunks(out);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[chunks.length - 1].type).toBe('IEND');
  });

  it('roundtrip：extract → write → 再 extract，data.* 深比较零丢失', () => {
    const first = extractCardData(fixtureBuf()) as Record<string, unknown>;
    const out = writeCardData(fixtureBuf(), first);
    const second = extractCardData(out) as Record<string, unknown>;
    expect(second.data).toEqual(first.data);
    // 双写：chara=V2 内容、ccv3=V3 内容（V2 内容 + spec 升级）
    const texts = parsePngChunks(out)
      .filter((c) => c.type === 'tEXt')
      .map((c) => c.data.toString('latin1').split('\0')[0]);
    expect(texts).toContain('chara');
    expect(texts).toContain('ccv3');
  });
});

describe('toInternalCard', () => {
  it('V1（无 data 字段）归一化为 V2 CharacterAsset', () => {
    const v1 = { name: '阿哥', description: '主角', personality: '沉稳', first_mes: '早' };
    const asset = toInternalCard(v1);
    expect(asset.card.spec).toBe('chara_card_v2');
    expect(asset.card.spec_version).toBe('2.0');
    expect(asset.card.data.name).toBe('阿哥');
    expect(asset.card.data.description).toBe('主角');
    expect(asset.card.data.personality).toBe('沉稳');
    expect(asset.name).toBe('阿哥');
    expect(asset.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('V2/V3 输入原样保留（含 spec 与未知字段）', () => {
    const v3 = extractCardData(fixtureBuf()) as Record<string, unknown>;
    const asset = toInternalCard(v3);
    expect(asset.card).toEqual(v3);
    expect(asset.name).toBe('Seraphina');
  });
});

// ---------- 路由层 ----------

describe('POST /api/io/characters', () => {
  it('未登录 → 401（ioCardRouter 自带 authRequired）', async () => {
    const res = await request(makeApp()).post('/api/io/characters/import');
    expect(res.status).toBe(401);
  });

  it('multipart 导入 PNG → 201 → GET /characters/:id 回读一致', async () => {
    const res = await request(makeApp())
      .post('/api/io/characters/import')
      .set(authed())
      .attach('file', fixtureBuf(), { filename: 'Seraphina.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.card.data.name).toBe('Seraphina');
    expect(res.body.avatar).toBe(`/data-assets/characters/${res.body.id}.png`);

    const back = await request(makeApp()).get(`/api/characters/${res.body.id}`).set(authed());
    expect(back.status).toBe(200);
    expect(back.body.card.data).toEqual(res.body.card.data);
  });

  it('导出 PNG → 再导入 → roundtrip 数据一致', async () => {
    const imported = await request(makeApp())
      .post('/api/io/characters/import')
      .set(authed())
      .attach('file', fixtureBuf(), { filename: 'Seraphina.png', contentType: 'image/png' });
    const { id } = imported.body;

    const png = await request(makeApp())
      .post('/api/io/characters/export')
      .set(authed())
      .send({ id, format: 'png' });
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toContain('image/png');

    const again = await request(makeApp())
      .post('/api/io/characters/import')
      .set(authed())
      .attach('file', png.body, { filename: 'roundtrip.png', contentType: 'image/png' });
    expect(again.status).toBe(201);
    expect(again.body.card.data).toEqual(imported.body.card.data);
  });

  it('导出 JSON → download 头 + V2 结构', async () => {
    const imported = await request(makeApp())
      .post('/api/io/characters/import')
      .set(authed())
      .attach('file', fixtureBuf(), { filename: 'Seraphina.png', contentType: 'image/png' });

    const json = await request(makeApp())
      .post('/api/io/characters/export')
      .set(authed())
      .send({ id: imported.body.id, format: 'json' });
    expect(json.status).toBe(200);
    expect(json.headers['content-type']).toContain('application/json');
    expect(json.headers['content-disposition']).toContain('.json');
    expect(json.body.card.data.name).toBe('Seraphina');
  });

  it('导出不存在的 id → 404；导入非法类型文件 → 400', async () => {
    const miss = await request(makeApp())
      .post('/api/io/characters/export')
      .set(authed())
      .send({ id: 'nope', format: 'png' });
    expect(miss.status).toBe(404);

    const bad = await request(makeApp())
      .post('/api/io/characters/import')
      .set(authed())
      .attach('file', Buffer.from('not a card'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(bad.status).toBe(400);
  });
});
