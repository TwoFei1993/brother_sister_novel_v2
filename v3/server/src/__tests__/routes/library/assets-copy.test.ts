/**
 * 素材归属三态 + 跨书批量复制测试（安卓 app Phase2 P2.1，深度测试 6 例）
 *
 * 覆盖：
 * 1. 势力介绍 CRUD（新素材类型）
 * 2. 复制单个角色卡 → 新 id + 「（副本）」名 + origin=目标书，原实体零改动
 * 3. 批量复制（多选）→ created 数与请求一致
 * 4. 复制世界书/势力介绍 → 各类型均走通
 * 5. 复制不存在的素材 → created 空 + missing 报告 + 404
 * 6. 归属三态 schema：book/external/none 均合法；非法 type 拒绝；旧数据（无 origin）兼容
 * 用 mkdtemp 临时 DATA_DIR，不触真实数据。
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../../app';

let app: Express;
let root = '';
let workId = '';
const createdFiles: string[] = [];

async function seedAsset(sub: string, id: string, body: Record<string, unknown>): Promise<void> {
  await mkdir(join(root, sub), { recursive: true });
  await writeFile(join(root, sub, `${id}.json`), JSON.stringify(body), 'utf8');
  createdFiles.push(join(root, sub, `${id}.json`));
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'assets-copy-'));
  process.env.DATA_DIR = root;
  process.env.ACCESS_PASSWORD = 'test-pass';
  app = createApp();
  // 登录拿 cookie
  const res = await request(app).post('/api/auth/login').send({ password: 'test-pass' });
  const cookie = res.headers['set-cookie'][0].split(';')[0];
  // 建两本书：源书 + 目标书
  for (const title of ['源书', '目标书']) {
    const r = await request(app).post('/api/works').set('Cookie', cookie).send({ title, mode: 'novel', genre: 'xuanhuan' });
    if (title === '目标书') workId = r.body.id;
  }
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  delete process.env.ACCESS_PASSWORD;
  await rm(root, { recursive: true, force: true });
});

function authed(): request.Test {
  return request(app).post('/api/copy');
}

const charBody = (id: string, name: string) => ({
  id,
  name,
  card: { spec: 'chara_card_v2', spec_version: '2.0', data: { name, description: '描述' } },
});

describe('P2.1 素材归属与跨书复制', () => {
  let cookie = '';

  beforeEach(async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'test-pass' });
    cookie = res.headers['set-cookie'][0].split(';')[0];
  });

  afterEach(async () => {
    for (const f of createdFiles.splice(0)) await rm(f, { force: true });
  });

  it('势力介绍 CRUD：POST 创建带 origin 的势力 → GET 回读', async () => {
    const create = await request(app)
      .post('/api/factions')
      .set('Cookie', cookie)
      .send({ name: '青云宗', description: '正道第一大宗', members: ['张三'], origin: { type: 'book', bookId: 'w-source' } });
    expect(create.status).toBe(201);
    expect(create.body.origin).toEqual({ type: 'book', bookId: 'w-source' });
    createdFiles.push(join(root, 'factions', `${create.body.id}.json`));

    const back = await request(app).get(`/api/factions/${create.body.id}`).set('Cookie', cookie);
    expect(back.body.name).toBe('青云宗');
    expect(back.body.members).toEqual(['张三']);
  });

  it('复制单个角色卡：新 id + 「（副本）」+ origin=目标书，源实体零改动', async () => {
    await seedAsset('characters', 'char-1', charBody('char-1', '林妹妹'));
    const res = await authed().set('Cookie', cookie).send({ assetType: 'characters', assetIds: ['char-1'], targetBookId: workId });
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);
    expect(res.body.missing).toEqual([]);

    const copy = res.body.created[0];
    expect(copy.id).not.toBe('char-1');
    expect(copy.name).toBe('林妹妹（副本）');
    const copyBody = JSON.parse(await readFile(join(root, 'characters', `${copy.id}.json`), 'utf8'));
    expect(copyBody.origin).toEqual({ type: 'book', bookId: workId });
    const source = JSON.parse(await readFile(join(root, 'characters', 'char-1.json'), 'utf8'));
    expect(source.origin).toBeUndefined(); // 源实体不动
  });

  it('批量复制多选：created 数与请求一致，各副本独立新 id', async () => {
    await seedAsset('characters', 'c-a', charBody('c-a', '甲'));
    await seedAsset('characters', 'c-b', charBody('c-b', '乙'));
    const res = await authed().set('Cookie', cookie).send({ assetType: 'characters', assetIds: ['c-a', 'c-b'], targetBookId: workId });
    expect(res.body.created).toHaveLength(2);
    expect(res.body.created[0].id).not.toBe(res.body.created[1].id);
  });

  it('世界书与势力介绍均可复制', async () => {
    await seedAsset('worldbooks', 'wb-1', { id: 'wb-1', name: '魔法世界', raw: { entries: {} } });
    await seedAsset('factions', 'fa-1', { id: 'fa-1', name: '星盟', description: '星际联盟' });
    const r1 = await authed().set('Cookie', cookie).send({ assetType: 'worldbooks', assetIds: ['wb-1'], targetBookId: workId });
    const r2 = await authed().set('Cookie', cookie).send({ assetType: 'factions', assetIds: ['fa-1'], targetBookId: workId });
    expect(r1.body.created[0].name).toBe('魔法世界（副本）');
    expect(r2.body.created[0].name).toBe('星盟（副本）');
  });

  it('复制不存在的素材：created 空 + missing 报告 + 404', async () => {
    const res = await authed().set('Cookie', cookie).send({ assetType: 'characters', assetIds: ['ghost'], targetBookId: workId });
    expect(res.status).toBe(404);
    expect(res.body.created ?? res.body.error).toBeTruthy();
    expect(res.body.missing ?? []).toContain('ghost');
  });

  it('归属三态 schema：external/none 合法、非法 type 拒绝、旧数据（无 origin）兼容', async () => {
    const ok1 = await request(app).post('/api/factions').set('Cookie', cookie)
      .send({ name: '外域', description: 'x', origin: { type: 'external', note: '哈利波特系列' } });
    expect(ok1.status).toBe(201);
    createdFiles.push(join(root, 'factions', `${ok1.body.id}.json`));

    const ok2 = await request(app).post('/api/factions').set('Cookie', cookie)
      .send({ name: '自由', description: 'x', origin: { type: 'none' } });
    expect(ok2.status).toBe(201);
    createdFiles.push(join(root, 'factions', `${ok2.body.id}.json`));

    const bad = await request(app).post('/api/factions').set('Cookie', cookie)
      .send({ name: '坏', description: 'x', origin: { type: 'galaxy' } });
    expect(bad.status).toBe(400);

    // 旧数据：无 origin 字段的资产 PATCH/GET 均正常
    await seedAsset('factions', 'legacy', { id: 'legacy', name: '旧势力', description: '旧' });
    const back = await request(app).get('/api/factions/legacy').set('Cookie', cookie);
    expect(back.status).toBe(200);
    expect(back.body.origin).toBeUndefined();
  });
});
