/**
 * library 路由测试 — characters 与 worldbooks（TDD，Task 6）
 *
 * 覆盖：每资源 POST→GET roundtrip、list、PATCH 合并、DELETE 后 404。
 * presets/regex-scripts/校验隔离见 library-more.test.ts，共享装置见 library-setup.ts。
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';

import {
  UUID_RE,
  authed,
  characterBody,
  makeApp,
  worldbookBody,
} from './library-setup';

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

  it('POST 同名幂等：第二次 200 返回既有资产（同 id），不新建重复卡', async () => {
    const app = makeApp();
    // 独立名字：同文件前序用例已建过「妹妹」，避免跨用例命中幂等
    const body = {
      ...characterBody,
      name: '幂等妹妹',
      card: { ...characterBody.card, data: { ...characterBody.card.data, name: '幂等妹妹' } },
    };
    const first = await request(app).post('/api/characters').set(authed()).send(body);
    expect(first.status).toBe(201); // 首次：新建
    const again = await request(app).post('/api/characters').set(authed()).send(body);
    expect(again.status).toBe(200); // 幂等命中：200（非 201）
    expect(again.body.id).toBe(first.body.id); // 返回既有资产
    const list = await request(app).get('/api/characters').set(authed());
    const mine = (list.body as Array<{ id: string; name: string }>).filter((x) => x.name === '幂等妹妹');
    expect(mine).toHaveLength(1); // 目录里仍只有一张卡（重试不产生重复）
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
