/**
 * works 路由测试（TDD，Task 7）：作品 CRUD + revision 乐观锁
 *
 * 覆盖：未登录 401、创建（目录+空 messages.jsonl+revision=1）、回读、
 * 浅列表、PATCH 正确 revision→N+1、过期 revision→409 CONFLICT、
 * 旧 revision 复放→409、DELETE 级联删目录、非法 body 400、404 边界、
 * id 路径穿越防护。
 *
 * worksRouter 尚未挂入 app.ts（协调者统一挂载），此处自装配 mini app：
 * json 解析 + worksRouter + HttpError 错误处理，与 app.ts 行为对齐。
 * 数据目录用 os.tmpdir() 随机临时目录（DATA_DIR env 注入），逐用例隔离。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';

import { createApp } from '../../../app';
import { worksRouter } from '../../../routes/works';
import { signToken } from '../../../middleware/auth';
import { HttpError } from '../../../middleware/validate';
import { defaultNovelSettings } from '@shared/work';

process.env.ACCESS_PASSWORD = 'test123';

/** mini app：与 app.ts 相同的 json 解析 + 错误处理语义（HttpError→状态码 JSON） */
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

/** 已登录请求代理：按方法分发并自动携带合法 token cookie（set 须跟在 get/post 之后） */
function authed(app: Express) {
  const cookie = `token=${signToken()}`;
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  };
}

/** 合法创建输入（settings 省略，服务端兜底 defaultNovelSettings） */
const validInput = {
  title: '穿越之兄妹修仙',
  mode: 'novel',
  genre: 'chuanyue',
};

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-works-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 创建一个作品并返回响应体（回读/更新类用例的公共前置） */
async function createWork(): Promise<SupertestResponse> {
  return authed(testApp()).post('/api/works').send(validInput);
}

/** 作品目录绝对路径（磁盘断言用） */
function workDir(id: string): string {
  return join(root, 'works', id);
}

describe('鉴权', () => {
  it('未登录 GET /api/works → 401', async () => {
    const res = await request(testApp()).get('/api/works');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('未登录 POST /api/works → 401', async () => {
    const res = await request(testApp()).post('/api/works').send(validInput);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/works 创建', () => {
  it('创建成功 → 201，revision=1，id/时间戳服务端生成，settings 兜底默认值', async () => {
    const res = await createWork();
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[\w-]+$/);
    expect(res.body.revision).toBe(1);
    expect(res.body.title).toBe(validInput.title);
    expect(res.body.mode).toBe('novel');
    expect(res.body.settings).toEqual(defaultNovelSettings);
    expect(typeof res.body.createdAt).toBe('number');
    expect(typeof res.body.updatedAt).toBe('number');
    expect(res.body.stats).toEqual({ messageCount: 0, chapterCount: 0, charCount: 0 });
  });

  it('创建后磁盘落地：work.json 存在 + messages.jsonl 存在且为空文件', async () => {
    const res = await createWork();
    const id = res.body.id as string;
    expect(existsSync(join(workDir(id), 'work.json'))).toBe(true);
    const messagesFile = join(workDir(id), 'messages.jsonl');
    expect(existsSync(messagesFile)).toBe(true);
    expect(await readFile(messagesFile, 'utf8')).toBe('');
  });

  it('非法 body：title 为空 → 400', async () => {
    const res = await authed(testApp()).post('/api/works').send({ ...validInput, title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('非法 body：mode 不在枚举内 → 400', async () => {
    const res = await authed(testApp())
      .post('/api/works')
      .send({ ...validInput, mode: 'movie' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/works/:id 回读', () => {
  it('创建后回读：字段与提交一致，revision=1', async () => {
    const created = await createWork();
    const id = created.body.id as string;
    const res = await authed(testApp()).get(`/api/works/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.revision).toBe(1);
    expect(res.body.title).toBe(validInput.title);
    expect(res.body.genre).toBe(validInput.genre);
    expect(res.body.settings).toEqual(defaultNovelSettings);
  });

  it('不存在的 id → 404', async () => {
    const res = await authed(testApp()).get('/api/works/no-such-work');
    expect(res.status).toBe(404);
  });

  it('id 含路径穿越片段 → 404（不泄露目录外文件）', async () => {
    const res = await authed(testApp()).get('/api/works/..%2F..%2Fsecrets');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/works 列表', () => {
  it('列表包含创建项，且为浅结构（id/title/mode/genre/updatedAt/stats）', async () => {
    await createWork();
    const res = await authed(testApp()).get('/api/works');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const item = res.body[0];
    expect(item.title).toBe(validInput.title);
    expect(item.mode).toBe('novel');
    expect(item.genre).toBe(validInput.genre);
    expect(typeof item.updatedAt).toBe('number');
    expect(item.stats).toEqual({ messageCount: 0, chapterCount: 0, charCount: 0 });
    // 浅列表不携带全量 settings
    expect(item.settings).toBeUndefined();
  });

  it('空库 → 空数组（目录不存在不报错）', async () => {
    const res = await authed(testApp()).get('/api/works');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('PATCH /api/works/:id 乐观锁', () => {
  it('携带当前 revision → 更新成功，revision+1 返回且落盘', async () => {
    const created = await createWork();
    const id = created.body.id as string;
    await new Promise((r) => setTimeout(r, 5)); // 保证 updatedAt 可比较
    const res = await authed(testApp())
      .patch(`/api/works/${id}`)
      .send({ revision: 1, title: '新标题', genre: 'scifi' });
    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(2);
    expect(res.body.title).toBe('新标题');
    expect(res.body.genre).toBe('scifi');
    expect(res.body.mode).toBe('novel'); // 未提交字段保持
    expect(res.body.updatedAt).toBeGreaterThan(created.body.updatedAt);
    // 落盘核对
    const disk = JSON.parse(await readFile(join(workDir(id), 'work.json'), 'utf8'));
    expect(disk.revision).toBe(2);
    expect(disk.title).toBe('新标题');
  });

  it('携带过期 revision → 409 {code:"CONFLICT"}，内容未被改写', async () => {
    const created = await createWork();
    const id = created.body.id as string;
    const res = await authed(testApp())
      .patch(`/api/works/${id}`)
      .send({ revision: 0, title: '迟到写入' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    // 磁盘仍是旧内容
    const disk = JSON.parse(await readFile(join(workDir(id), 'work.json'), 'utf8'));
    expect(disk.title).toBe(validInput.title);
  });

  it('成功更新后，旧 revision 再试 → 409（版本号已前进）', async () => {
    const created = await createWork();
    const id = created.body.id as string;
    const ok = await authed(testApp())
      .patch(`/api/works/${id}`)
      .send({ revision: 1, title: '第一次' });
    expect(ok.status).toBe(200);
    const stale = await authed(testApp())
      .patch(`/api/works/${id}`)
      .send({ revision: 1, title: '复放写入' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONFLICT');
  });

  it('PATCH 不存在的 id → 404', async () => {
    const res = await authed(testApp())
      .patch('/api/works/no-such-work')
      .send({ revision: 1, title: '幽灵' });
    expect(res.status).toBe(404);
  });

  it('body 缺 revision → 400（乐观锁必带版本号）', async () => {
    const created = await createWork();
    const res = await authed(testApp())
      .patch(`/api/works/${created.body.id}`)
      .send({ title: '没带版本号' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/works/:id 级联删除', () => {
  it('删除后 GET 404，data/works/<id>/ 整目录不存在', async () => {
    const created = await createWork();
    const id = created.body.id as string;
    expect(existsSync(workDir(id))).toBe(true);
    const res = await authed(testApp()).delete(`/api/works/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(await authed(testApp()).get(`/api/works/${id}`)).toHaveProperty('status', 404);
    expect(existsSync(workDir(id))).toBe(false);
  });

  it('删除后列表不再包含该项', async () => {
    await createWork();
    const list1 = await authed(testApp()).get('/api/works');
    const id = list1.body[0].id as string;
    await authed(testApp()).delete(`/api/works/${id}`);
    const list2 = await authed(testApp()).get('/api/works');
    expect(list2.body).toHaveLength(0);
  });

  it('删除不存在的 id → 404', async () => {
    const res = await authed(testApp()).delete('/api/works/no-such-work');
    expect(res.status).toBe(404);
  });
});

describe('真实 app 装载冒烟', () => {
  it('createApp() 探活仍 200（确认本任务未破坏既有装配）', async () => {
    const res = await request(createApp()).get('/api/ping');
    expect(res.status).toBe(200);
  });
});
