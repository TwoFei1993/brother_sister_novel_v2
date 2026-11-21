/**
 * M2 Task 3.3 测试：novel-chapter runner 端到端（executeNovelChapter 实装）。
 * fixture 书 + 脚本化上游（全局 fetch mock）→ supertest 直打 llmTasksRouter：
 * 提交 → 轮询 GET ?since 增量（progress 中途可见）→ 终态 done/failed →
 * messages.jsonl 入库核对 / resultMessageIds / 并发编排器排队 / 作品已删除区分。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { Router, type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

import { defaultNovelSettings, type Work } from '@shared/work';

import { llmTasksRouter } from '../routes/llm/tasks';
import { llmTasksDir } from '../routes/llm/tasksNovel';
import { queuedNovelCount, resetDesiredParallel, runningNovelCount } from '../services/novelQueue';
import { readAll } from '../storage/jsonl';
import { readJson, writeJsonAtomic } from '../storage/store';
import { authRequired, signToken } from '../middleware/auth';
import { HttpError } from '../middleware/validate';
import { worksDir } from '../routes/works/works';

process.env.ACCESS_PASSWORD = 'test123';

function testApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', authRequired);
  const tasksMount = Router();
  tasksMount.use('/llm/tasks', llmTasksRouter);
  app.use('/api', tasksMount);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  });
  return app;
}

function authed(app: Express) {
  const cookie = `token=${signToken()}`;
  return {
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
  };
}

function novelBody(workId: string, extra: Record<string, unknown> = {}) {
  return { kind: 'novel-chapter', workId, prefs: { source: 'openai', model: 'm3' }, ...extra };
}

function sseResponse(text: string) {
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** fixture 书（tw=2000 → parts=1，每章恰好一次上游调用） */
async function seedWork(workId: string, existingChapters = 0): Promise<void> {
  const work = {
    id: workId,
    revision: 1,
    title: 'runner 测试书',
    mode: 'novel',
    genre: '兄妹',
    characterIds: [],
    worldbookIds: [],
    factionIds: [],
    itemIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings, targetChapterWords: 2000 },
    voiceMap: {},
    stats: { messageCount: existingChapters, chapterCount: existingChapters, charCount: 0 },
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Work;
  await writeJsonAtomic(join(worksDir(), workId, 'work.json'), work);
  const existing = Array.from({ length: existingChapters }, (_, i) => ({
    id: `seed-${i + 1}`,
    role: 'assistant',
    name: '小说家',
    content: `第${i + 1}章既有正文。`,
    createdAt: 1,
    swipes: [{ id: `seed-${i + 1}-v1`, name: 'v1', content: `第${i + 1}章既有正文。`, origin: 'ai', createdAt: 1 }],
    swipeId: 0,
    chapter: { index: i + 1, title: `第${i + 1}章` },
    extra: {},
  }));
  await writeFile(join(worksDir(), workId, 'messages.jsonl'), existing.map((m) => JSON.stringify(m)).join('\n') + (existing.length > 0 ? '\n' : ''), 'utf8');
}

function messagesPath(workId: string): string {
  return join(worksDir(), workId, 'messages.jsonl');
}

/** 轮询直到满足条件（默认 5s 超时） */
async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** 轮询任务直到终态，返回终态响应 */
async function waitFinished(a: ReturnType<typeof authed>, id: string): Promise<Record<string, unknown>> {
  let final: Record<string, unknown> = {};
  for (let i = 0; i < 100; i += 1) {
    const g = await a.get(`/api/llm/tasks/${id}`);
    final = g.body as Record<string, unknown>;
    if (final.status === 'done' || final.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return final;
}

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-llm-tasks-runner-'));
  process.env.DATA_DIR = root;
  process.env.OPENAI_API_KEY = 'mock-key';
  await writeFile(join(root, 'secrets.json'), JSON.stringify({ openai: { apiKey: 'mock-key' } }), 'utf8');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.NOVEL_GEN_PARALLEL;
  resetDesiredParallel(); // 清批量并发意图（模块级内存态，跨用例残留防御）
  delete process.env.LLM_TASK_RETRY_DELAYS_MS;
  await rm(root, { recursive: true, force: true });
});

describe('runner 端到端（提交→轮询→终态→入库）', () => {
  it('chapters=2：progress 中途可见（done=1/progressLen>0）→ done + 双章入库 + resultMessageIds', async () => {
    await seedWork('w-e2e', 1); // 1 既有章 → 新章为第 2、3 章
    let release2!: () => void;
    const gate2 = new Promise<void>((r) => {
      release2 = r;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        // mock.calls 在实现执行前已含当前调用：第 1 次调用=第 2 章（立即返回），第 2 次=第 3 章（挂起）
        if (vi.mocked(fetch).mock.calls.length === 2) await gate2;
        return vi.mocked(fetch).mock.calls.length === 1
          ? sseResponse('# 第2章 接续\n第二章写完了。')
          : sseResponse('# 第3章 收束\n第三章写完了。');
      }),
    );
    const app = testApp();
    const a = authed(app);
    const sub = await a.post('/api/llm/tasks').send(novelBody('w-e2e', { chapters: 2, directive: '接着写' }));
    expect(sub.status).toBe(202);
    const id = sub.body.taskId as string;

    // 轮询 ?since=0：第 1 章完成后（第 2 章被 gate 挂起）应观察到中途进度
    let mid: Record<string, unknown> = {};
    for (let i = 0; i < 100; i += 1) {
      const g = await a.get(`/api/llm/tasks/${id}?since=0`);
      mid = g.body as Record<string, unknown>;
      if (Number(mid.done) >= 1 && Number(mid.progressLen) > 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(mid.status).toBe('running');
    expect(mid.done).toBe(1); // 第 1 章已完成（saving 进度强制落盘）
    expect(Number(mid.progressLen)).toBeGreaterThan(0); // 当前章累计正文可见
    expect(Number(mid.chapterTotal)).toBe(2);

    release2();
    const final = await waitFinished(a, id);
    expect(final.status).toBe('done');
    expect(final.resultMessages).toBe(2);
    expect(final.resultMessageIds).toHaveLength(2);
    // D9：入库消息核对——既有 1 章 + 新 2 章，章号连续
    const rows = await readAll<{ id: string; chapter?: { index: number }; content: string }>(messagesPath('w-e2e'));
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.chapter?.index)).toEqual([1, 2, 3]);
    expect(rows[1]?.content).toContain('第二章写完了');
    expect(rows[2]?.content).toContain('第三章写完了');
    expect(final.resultMessageIds).toEqual([rows[1]?.id, rows[2]?.id]);
    // 终态清执行期增量
    const disk = await readJson<{ status: string; progress?: unknown }>(join(llmTasksDir(), `${id}.json`));
    expect(disk?.status).toBe('done');
    expect(disk?.progress).toBeUndefined();
  });

  it('书已删除（work.json 缺失）→ 任务 failed 且错误区分「作品已删除」', async () => {
    const app = testApp();
    const a = authed(app);
    const sub = await a.post('/api/llm/tasks').send(novelBody('w-gone'));
    expect(sub.status).toBe(202);
    const final = await waitFinished(a, sub.body.taskId);
    expect(final.status).toBe('failed');
    expect(String(final.error)).toContain('作品已删除');
    expect(runningNovelCount()).toBe(0); // 槽位已释放（finally）
  });
});

describe('runner 与并发编排器接入（D7）', () => {
  it('NOVEL_GEN_PARALLEL=1：第二个任务排队（queued）而非并发执行，前序释放后接续', async () => {
    process.env.NOVEL_GEN_PARALLEL = '1';
    await seedWork('w-q-a');
    await seedWork('w-q-b');
    let hold = true;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        while (hold) await new Promise((r) => setTimeout(r, 20));
        return sseResponse('# 第1章 正文\n排队测试正文。');
      }),
    );
    const app = testApp();
    const a = authed(app);
    const first = await a.post('/api/llm/tasks').send(novelBody('w-q-a'));
    const second = await a.post('/api/llm/tasks').send(novelBody('w-q-b'));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    // 第一个任务占坑 running，第二个排队（互斥不误伤不同书——两任务均 202）
    await waitFor(() => runningNovelCount() === 1);
    expect(queuedNovelCount()).toBe(1); // FIFO 队列中等待槽位
    expect(runningNovelCount()).toBe(1); // 并发上限 1 生效
    hold = false;
    const fa = await waitFinished(a, first.body.taskId);
    const fb = await waitFinished(a, second.body.taskId);
    expect(fa.status).toBe('done');
    expect(fb.status).toBe('done');
    expect(runningNovelCount()).toBe(0);
    expect(queuedNovelCount()).toBe(0);
  });

  it('提交带 parallel=1：全局 desired limit 即时生效（env 未设，批量并发参数优先）', async () => {
    await seedWork('w-q-c');
    await seedWork('w-q-d');
    let hold = true;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        while (hold) await new Promise((r) => setTimeout(r, 20));
        return sseResponse('# 第1章 正文\n并发参数测试正文。');
      }),
    );
    const app = testApp();
    const a = authed(app);
    // 第一次提交带 parallel=1（互斥通过后应用 setDesiredParallel）——后续提交（不带 parallel）同受其约束
    const first = await a.post('/api/llm/tasks').send(novelBody('w-q-c', { parallel: 1 }));
    const second = await a.post('/api/llm/tasks').send(novelBody('w-q-d'));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    await waitFor(() => runningNovelCount() === 1);
    expect(runningNovelCount()).toBe(1); // desired=1 生效（默认上限 2 被覆盖）
    expect(queuedNovelCount()).toBe(1); // 第二个任务排队
    hold = false;
    const fa = await waitFinished(a, first.body.taskId);
    const fb = await waitFinished(a, second.body.taskId);
    expect(fa.status).toBe('done');
    expect(fb.status).toBe('done');
    expect(runningNovelCount()).toBe(0);
    expect(queuedNovelCount()).toBe(0);
  });
});
