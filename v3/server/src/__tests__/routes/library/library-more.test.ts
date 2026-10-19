/**
 * library 路由测试 — presets / regex-scripts / 校验与目录隔离（TDD，Task 6）
 *
 * 覆盖：presets 与 regex 的 roundtrip/PATCH/DELETE、raw passthrough 保字段、
 * strict 壳拒未知字段、characters 与 worldbooks 落不同目录、鉴权边界。
 * characters/worldbooks 见 library.test.ts，共享装置见 library-setup.ts。
 */
import { describe, expect, it } from 'vitest';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';

import {
  authed,
  characterBody,
  makeApp,
  presetBody,
  regexBody,
  rootPath,
  worldbookBody,
} from './library-setup';

// ---------- 鉴权 ----------

describe('鉴权边界', () => {
  it('未带登录态访问资产列表 → 401', async () => {
    const res = await request(makeApp()).get('/api/characters');
    expect(res.status).toBe(401);
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
    const root = rootPath();
    await expect(stat(join(root, 'characters', `${c.body.id}.json`))).resolves.toBeTruthy();
    await expect(stat(join(root, 'worldbooks', `${w.body.id}.json`))).resolves.toBeTruthy();
    const characterFiles = await readdir(join(root, 'characters'));
    expect(characterFiles).not.toContain(`${w.body.id}.json`);
  });
});
