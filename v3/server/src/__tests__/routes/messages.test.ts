/**
 * messages 路由测试（TDD，Task 8）：JSONL 消息流（设计 §4.5/§4.6）
 * 覆盖：三窗口读取及锚点兜底语义（jsonl 契约）、POST 幂等 upsert、PATCH last-write-wins、
 * DELETE 单条、未登录 401、404 边界。mini app 自装配同 works.test.ts；读取用例直写种子，写入走 API。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

import { worksRouter } from '../../routes/works';
import { signToken } from '../../middleware/auth';
import { HttpError } from '../../middleware/validate';
import { readAll } from '../../storage/jsonl';
import type { Message } from '@shared/message';

process.env.ACCESS_PASSWORD = 'test123';

/** mini app：与 app.ts 相同的 json 解析 + 错误处理语义（HttpError→状态码 JSON） */
function testApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', worksRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: '内部错误' });
  });
  return app;
}

/** 已登录请求代理：自动携带合法 token cookie */
function authed(app: Express) {
  const cookie = `token=${signToken()}`;
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  };
}

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-messages-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

// ---------- 造数工具 ----------

/** 消息工厂：content 恒定 5 字（"内容NNN"），偶数条=assistant 且带 chapter，便于 stats 精确断言 */
function msg(i: number, over: Partial<Message> = {}): Message {
  const content = `内容${String(i).padStart(3, '0')}`;
  return {
    id: `m${String(i).padStart(3, '0')}`,
    role: i % 2 === 0 ? 'assistant' : 'user',
    name: i % 2 === 0 ? '小说家' : '作者',
    content,
    createdAt: 1700000000000 + i,
    swipes: [content],
    swipeId: 0,
    chapter: i % 2 === 0 ? { index: i / 2, title: `第${i / 2}章` } : undefined,
    extra: {},
    ...over,
  };
}

/** 创建作品（走 API，初始化 work.json 与空 messages.jsonl），返回 id */
async function createWork(): Promise<string> {
  const res = await authed(testApp()).post('/api/works').send({ title: '测试作品', mode: 'novel', genre: 'chuanyue' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

/** 直接向 messages.jsonl 写种子行（读取类用例前置，绕开 API 提速） */
async function seedMessages(workId: string, msgs: Message[]): Promise<void> {
  const file = join(root, 'works', workId, 'messages.jsonl');
  await mkdir(dirname(file), { recursive: true });
  const body = msgs.map((m) => JSON.stringify(m)).join('\n');
  await writeFile(file, msgs.length > 0 ? `${body}\n` : '', 'utf8');
}

/** 读取磁盘 work.json 的 stats */
async function diskStats(workId: string) {
  const work = JSON.parse(await readFile(join(root, 'works', workId, 'work.json'), 'utf8'));
  return work.stats;
}

describe('鉴权', () => {
  it('未登录 GET /api/works/:id/messages → 401', async () => {
    const res = await request(testApp()).get('/api/works/x/messages');
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('未登录 POST /api/works/:id/messages → 401', async () => {
    const res = await request(testApp()).post('/api/works/x/messages').send(msg(1));
    expect(res.status).toBe(401);
  });
});

describe('GET 读取三窗口（§4.6）', () => {
  let workId = '';
  beforeEach(async () => {
    workId = await createWork();
    // 60 条：assistant 30 条（偶数）×5 字 = charCount 150；chapter 30
    await seedMessages(workId, Array.from({ length: 60 }, (_, k) => msg(k + 1)));
  });

  it('tail 默认 50：返回最后 50 条（m011..m060），hasMore=true', async () => {
    const res = await authed(testApp()).get(`/api/works/${workId}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(50);
    expect(res.body.messages[0].id).toBe('m011');
    expect(res.body.messages[49].id).toBe('m060');
    expect(res.body.hasMore).toBe(true);
  });

  it('tail=10 显式窗口：最后 10 条，hasMore=true', async () => {
    const res = await authed(testApp()).get(`/api/works/${workId}/messages?tail=10`);
    expect(res.body.messages).toHaveLength(10);
    expect(res.body.messages[0].id).toBe('m051');
    expect(res.body.hasMore).toBe(true);
  });

  it('before 游标：before=m030&limit=20 → m010..m029，hasMore=true（更早还有）', async () => {
    const res = await authed(testApp()).get(`/api/works/${workId}/messages?before=m030&limit=20`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(20);
    expect(res.body.messages[0].id).toBe('m010');
    expect(res.body.messages[19].id).toBe('m029');
    expect(res.body.hasMore).toBe(true);
  });

  it('before 翻到头：before=m001 → 空窗口，hasMore=false（翻页停止信号）', async () => {
    const res = await authed(testApp()).get(`/api/works/${workId}/messages?before=m001&limit=50`);
    expect(res.body.messages).toHaveLength(0);
    expect(res.body.hasMore).toBe(false);
  });

  it('before 锚点不存在 → 兜底返回尾部 limit 条（jsonl 语义锁定）', async () => {
    const res = await authed(testApp()).get(`/api/works/${workId}/messages?before=ghost&limit=5`);
    expect(res.body.messages).toHaveLength(5);
    expect(res.body.messages[4].id).toBe('m060');
  });

  it('since 增量：since=m020 → m021..m060 共 40 条（无 hasMore）', async () => {
    const res = await authed(testApp()).get(`/api/works/${workId}/messages?since=m020`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(40);
    expect(res.body.messages[0].id).toBe('m021');
    expect(res.body.messages[39].id).toBe('m060');
    expect(res.body.hasMore).toBeUndefined();
  });

  it('since 锚点不存在 → 返回全部（多端对齐兜底，jsonl 语义锁定）', async () => {
    const res = await authed(testApp()).get(`/api/works/${workId}/messages?since=ghost`);
    expect(res.body.messages).toHaveLength(60);
  });

  it('非法数字参数：tail=abc → 400', async () => {
    const res = await authed(testApp()).get(`/api/works/${workId}/messages?tail=abc`);
    expect(res.status).toBe(400);
  });

  it('作品不存在 → 404', async () => {
    const res = await authed(testApp()).get('/api/works/no-such-work/messages');
    expect(res.status).toBe(404);
  });
});

describe('POST 幂等 upsert（§9.2 生成入库）', () => {
  let workId = '';
  beforeEach(async () => {
    workId = await createWork();
    await seedMessages(workId, Array.from({ length: 60 }, (_, k) => msg(k + 1)));
  });

  it('新消息追加：返回 {ok, revision}，行数 +1 且 GET 可回读', async () => {
    const res = await authed(testApp()).post(`/api/works/${workId}/messages`).send(msg(61, { chapter: undefined }));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.revision).toBe(1); // 消息写入不动 revision

    const all = await readAll<Message>(join(root, 'works', workId, 'messages.jsonl'));
    expect(all).toHaveLength(61);
    expect(all[60].id).toBe('m061');
    const back = await authed(testApp()).get(`/api/works/${workId}/messages?tail=1`);
    expect(back.body.messages[0].id).toBe('m061');
  });

  it('同 id 重发不重复：整行替换为最新内容（幂等 upsert）', async () => {
    const post = (content: string) =>
      authed(testApp()).post(`/api/works/${workId}/messages`).send(msg(61, { content }));
    expect((await post('第一版正文')).status).toBe(200);
    expect((await post('重发后的完整正文')).status).toBe(200); // 断流重试：同 id 再发

    const all = await readAll<Message>(join(root, 'works', workId, 'messages.jsonl'));
    expect(all).toHaveLength(61); // 不产生重复行
    expect(all[60].id).toBe('m061');
    expect(all[60].content).toBe('重发后的完整正文'); // 后写覆盖
  });

  it('POST 后 work.json stats 重算：messageCount/chapterCount/charCount', async () => {
    // 种子 60 条（assistant 30×5 字=150，chapter 30）；新增 assistant +5 字 +1 章
    const m61 = msg(61, { role: 'assistant', chapter: { index: 31, title: '第31章' } });
    await authed(testApp()).post(`/api/works/${workId}/messages`).send(m61);
    expect(await diskStats(workId)).toEqual({ messageCount: 61, chapterCount: 31, charCount: 155 });
  });

  it('非法 body：缺 swipes 字段 → 400（strict schema）', async () => {
    const { swipes: _drop, ...missing } = msg(61);
    const res = await authed(testApp()).post(`/api/works/${workId}/messages`).send(missing);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('非法 body：未知多余字段 → 400（strict schema）', async () => {
    const res = await authed(testApp())
      .post(`/api/works/${workId}/messages`)
      .send({ ...msg(61), hacker: true });
    expect(res.status).toBe(400);
  });
});

describe('PATCH last-write-wins（swipe 切换/编辑）', () => {
  let workId = '';
  beforeEach(async () => {
    workId = await createWork();
    await seedMessages(workId, [msg(1), msg(2), msg(3)]);
  });

  it('PATCH 切换 swipeId → GET 回读新 swipeId（swipe 候选追加）', async () => {
    const swiped = msg(2, { swipes: ['内容002', '第二支候选'], swipeId: 1 });
    const res = await authed(testApp()).patch(`/api/works/${workId}/messages/m002`).send(swiped);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const back = await authed(testApp()).get(`/api/works/${workId}/messages?tail=3`);
    const m2 = back.body.messages.find((m: Message) => m.id === 'm002');
    expect(m2.swipeId).toBe(1);
    expect(m2.swipes).toEqual(['内容002', '第二支候选']);
    expect(back.body.messages).toHaveLength(3); // 不新增行
  });

  it('PATCH 编辑 content → 回读生效且 charCount 重算', async () => {
    const edited = msg(2, { content: '改写后的长正文' }); // 7 字
    const res = await authed(testApp()).patch(`/api/works/${workId}/messages/m002`).send(edited);
    expect(res.status).toBe(200);
    expect((await diskStats(workId)).charCount).toBe(7); // 整条替换后仅此 7 字计入
    const back = await authed(testApp()).get(`/api/works/${workId}/messages?tail=3`);
    const m2 = back.body.messages.find((m: Message) => m.id === 'm002');
    expect(m2.content).toBe('改写后的长正文');
  });

  it('body.id 与路径 mid 不一致 → 400', async () => {
    const res = await authed(testApp())
      .patch(`/api/works/${workId}/messages/m002`)
      .send(msg(3));
    expect(res.status).toBe(400);
  });

  it('PATCH 不存在的 mid → 404', async () => {
    const ghost = msg(9, { id: 'ghost' }); // body.id 与路径一致，走到存在性检查
    const res = await authed(testApp()).patch(`/api/works/${workId}/messages/ghost`).send(ghost);
    expect(res.status).toBe(404);
  });
});

describe('DELETE 单条', () => {
  let workId = '';
  beforeEach(async () => {
    workId = await createWork();
    await seedMessages(workId, [msg(1), msg(2), msg(3)]);
  });

  it('删除后 readAll 无此行且 stats 重算', async () => {
    const res = await authed(testApp()).delete(`/api/works/${workId}/messages/m002`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const all = await readAll<Message>(join(root, 'works', workId, 'messages.jsonl'));
    expect(all.map((m) => m.id)).toEqual(['m001', 'm003']);
    expect(await diskStats(workId)).toEqual({ messageCount: 2, chapterCount: 0, charCount: 0 });
  });

  it('DELETE 不存在的 mid → 404', async () => {
    const res = await authed(testApp()).delete(`/api/works/${workId}/messages/ghost`);
    expect(res.status).toBe(404);
  });
});
