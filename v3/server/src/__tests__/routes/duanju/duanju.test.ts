/**
 * duanju 路由测试（实施计划 T1.3/T1.4）：project.json 读写 + 乐观锁 + 创建分支
 *
 * 覆盖：duanju 作品创建（project.json 落盘 revision=1 / 无 messages.jsonl）、
 * novel 作品创建不受影响（无 duanju 目录、有 messages.jsonl）、GET 404、
 * PATCH 正确 revision→N+1 / 过期→409、DuanjuInitSchema 默认值兜底、
 * 非法字段 strict 拒绝 400。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

import { worksRouter } from '../../../routes/works';
import { signToken } from '../../../middleware/auth';
import { HttpError } from '../../../middleware/validate';

process.env.ACCESS_PASSWORD = 'test123';

function testApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', worksRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: '内部错误' });
  });
  return app;
}

function authed(app: Express) {
  const cookie = `token=${signToken()}`;
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
  };
}

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-duanju-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('duanju 作品创建', () => {
  it('mode=duanju：project.json 落盘且无 messages.jsonl', async () => {
    const app = testApp();
    const res = await authed(app).post('/api/works').send({
      title: '测试短剧',
      mode: 'duanju',
      genre: 'chuanyue',
      duanju: { targetEpisodes: 8, style: '3D 卡通', protagonists: '两个机器人' },
    });
    expect(res.status).toBe(201);
    const dir = join(root, 'works', res.body.id);
    expect(existsSync(join(dir, 'duanju', 'project.json'))).toBe(true);
    expect(existsSync(join(dir, 'messages.jsonl'))).toBe(false);

    const project = JSON.parse(await readFile(join(dir, 'duanju', 'project.json'), 'utf8'));
    expect(project.revision).toBe(1);
    expect(project.style).toBe('3D 卡通');
    expect(project.targetEpisodes).toBe(8);
    expect(project.protagonists).toBe('两个机器人');
    expect(project.script.confirmed).toBe(false);
  });

  it('duanju 缺省：targetEpisodes=12 / style=动漫风', async () => {
    const app = testApp();
    const res = await authed(app).post('/api/works').send({
      title: '默认短剧',
      mode: 'duanju',
      genre: 'chuanyue',
    });
    expect(res.status).toBe(201);
    const project = await authed(app).get(`/api/works/${res.body.id}/duanju`);
    expect(project.body.targetEpisodes).toBe(12);
    expect(project.body.style).toBe('动漫风');
  });

  it('mode=novel：不受影响（无 duanju 目录、有 messages.jsonl）', async () => {
    const app = testApp();
    const res = await authed(app).post('/api/works').send({
      title: '普通小说',
      mode: 'novel',
      genre: 'chuanyue',
    });
    expect(res.status).toBe(201);
    const dir = join(root, 'works', res.body.id);
    expect(existsSync(join(dir, 'duanju'))).toBe(false);
    expect(existsSync(join(dir, 'messages.jsonl'))).toBe(true);
  });
});

describe('duanju project 读写', () => {
  async function createDuanju(app: Express): Promise<string> {
    const res = await authed(app).post('/api/works').send({
      title: 't',
      mode: 'duanju',
      genre: 'chuanyue',
    });
    return res.body.id as string;
  }

  it('GET：回读全量；不存在的 work → 404；novel work → 404', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const got = await authed(app).get(`/api/works/${id}/duanju`);
    expect(got.status).toBe(200);
    expect(got.body.shots).toEqual([]);

    expect((await authed(app).get('/api/works/nonexistent/duanju')).status).toBe(404);

    const novel = await authed(app).post('/api/works').send({
      title: 'n', mode: 'novel', genre: 'chuanyue',
    });
    expect((await authed(app).get(`/api/works/${novel.body.id}/duanju`)).status).toBe(404);
  });

  it('PATCH：正确 revision → 字段更新 + revision+1；过期 revision → 409', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const r1 = await authed(app).patch(`/api/works/${id}/duanju`).send({
      revision: 1,
      script: { source: 'pasted', text: '第一集剧本……', confirmed: true, updatedAt: 1 },
      style: '写实',
    });
    expect(r1.status).toBe(200);
    expect(r1.body.revision).toBe(2);
    expect(r1.body.script.confirmed).toBe(true);
    expect(r1.body.style).toBe('写实');

    const stale = await authed(app).patch(`/api/works/${id}/duanju`).send({
      revision: 1,
      style: '国漫',
    });
    expect(stale.status).toBe(409);

    const r2 = await authed(app).patch(`/api/works/${id}/duanju`).send({
      revision: 2,
      characters: [{
        id: 'c1', name: '小满', profile: '蓝发双马尾', sheetImages: [],
        refImageId: null, updatedAt: 5,
      }],
    });
    expect(r2.status).toBe(200);
    expect(r2.body.characters).toHaveLength(1);
    expect(r2.body.script.confirmed).toBe(true); // 未提交字段保持
  });

  it('PATCH：未知字段 strict 拒绝 400', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const res = await authed(app).patch(`/api/works/${id}/duanju`).send({
      revision: 1,
      hack: true,
    });
    expect(res.status).toBe(400);
  });

  it('未登录：401', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    expect((await request(app).get(`/api/works/${id}/duanju`)).status).toBe(401);
  });
});
