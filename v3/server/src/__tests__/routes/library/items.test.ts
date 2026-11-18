/**
 * 物品道具路由测试（用户需求：特殊物品道具资料卡——质感/形状/颜色/功能/承载感情结构化描述）
 *
 * 覆盖：POST→GET roundtrip（可选字段缺省合法）、list、PATCH 结构化字段合并、
 * 全空可选段合法（describeItem 注入只拼非空段）、DELETE 后 404、未鉴权 401。
 * 共享装置见 library-setup.ts（独立临时目录 + 自装配 app）。
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { UUID_RE, authed, makeApp } from './library-setup';

const itemBody = {
  name: '母亲的银锁',
  summary: '妹妹随身携带的旧银锁，锁内藏着母亲留下的字条',
  texture: '温润的羊脂玉触感',
  shape: '拇指大小的圆锁，环刻缠枝纹',
  color: '月白色，泛淡银光',
  usage: '贴身佩戴时能安抚异能反噬；离开身体超过一炷香即失效',
  emotion: '母亲唯一的遗物，妹妹视为不能失去的护身符',
};

describe('POST/GET /api/items（物品道具资料卡）', () => {
  it('POST 创建 → 201 + 服务端生成 uuid id，结构化字段全量落盘', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/items').set(authed()).send(itemBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(UUID_RE);
    expect(res.body.name).toBe(itemBody.name);
    const got = await request(app).get(`/api/items/${res.body.id}`).set(authed());
    expect(got.status).toBe(200);
    expect(got.body.emotion).toBe(itemBody.emotion);
    expect(got.body.usage).toBe(itemBody.usage);
    expect(got.body.texture).toBe(itemBody.texture);
  });

  it('仅 name+summary 的最小物品合法（可选段缺省=注入时跳过）', async () => {
    const res = await request(makeApp())
      .post('/api/items')
      .set(authed())
      .send({ name: '星陨剑', summary: '坠星铁所铸的短剑' });
    expect(res.status).toBe(201);
    expect(res.body.texture).toBeUndefined();
  });

  it('name 缺失 → 400（唯一必填语义字段）', async () => {
    const res = await request(makeApp()).post('/api/items').set(authed()).send({ summary: '无名物品' });
    expect(res.status).toBe(400);
  });

  it('未知字段 → 400（strictObject 防脏数据）', async () => {
    const res = await request(makeApp()).post('/api/items').set(authed()).send({ ...itemBody, hack: 1 });
    expect(res.status).toBe(400);
  });

  it('PATCH 结构化字段浅合并：只改 emotion 不动其他段', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/items').set(authed()).send(itemBody);
    const patched = await request(app)
      .patch(`/api/items/${created.body.id}`)
      .set(authed())
      .send({ emotion: '兄妹共同守护的羁绊信物' });
    expect(patched.status).toBe(200);
    expect(patched.body.emotion).toBe('兄妹共同守护的羁绊信物');
    expect(patched.body.texture).toBe(itemBody.texture);
    expect(patched.body.usage).toBe(itemBody.usage);
  });

  it('list 浅列表 + DELETE 幂等（删后 GET 404）', async () => {
    const app = makeApp();
    const created = await request(app).post('/api/items').set(authed()).send(itemBody);
    const list = await request(app).get('/api/items').set(authed());
    expect(list.status).toBe(200);
    expect((list.body as Array<{ id: string }>).some((x) => x.id === created.body.id)).toBe(true);
    expect((await request(app).delete(`/api/items/${created.body.id}`).set(authed())).status).toBe(204);
    expect((await request(app).delete(`/api/items/${created.body.id}`).set(authed())).status).toBe(204); // 幂等（无内容）
    expect((await request(app).get(`/api/items/${created.body.id}`).set(authed())).status).toBe(404);
  });

  it('未鉴权 → 401', async () => {
    expect((await request(makeApp()).get('/api/items')).status).toBe(401);
  });
});

