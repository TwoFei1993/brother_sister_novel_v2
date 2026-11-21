/**
 * M2 novel-chapter 任务基建测试（Task 1.1）：
 * 提交 schema union（novel-chapter 202 且落盘 kind/workId/prefs）/ 同书互斥 409
 * （含 cancelRequested=true 的取消中任务）/ POST /:id/cancel（置位/终态 ok:false/缺失 404 lost）/
 * GET /active 列表（进行中含、终态消失）/ GET ?since= 增量切片协议 /
 * 终态附加 resultMessages/resultMessageIds / 旧 llm 任务（无 kind）零影响
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { Router, type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

import { llmTasksRouter } from '../routes/llm/tasks';
import { llmTasksDir } from '../routes/llm/tasksNovel';
import { readJson, writeJsonAtomic } from '../storage/store';
import { authRequired, signToken } from '../middleware/auth';
import { HttpError } from '../middleware/validate';
import { defaultNovelSettings, type Work } from '@shared/work';
import { worksDir } from '../routes/works/works';

process.env.ACCESS_PASSWORD = 'test123';

function testApp(): Express {
  const app = express();
  app.use(express.json());
  // 与生产 app.ts 同构挂载：llmRouter.use('/llm/tasks', llmTasksRouter) 剥前缀 + auth 层
  app.use('/api', authRequired);
  const tasksMount = Router();
  tasksMount.use('/llm/tasks', llmTasksRouter);
  app.use('/api', tasksMount);
  // 与生产 errorHandler 对齐：HttpError 用自带 status（zod 校验 400 路径在测），其余 500
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

/** novel-chapter 提交体（最小合法：prefs 必填，其余走 schema default） */
function novelBody(workId: string, extra: Record<string, unknown> = {}) {
  return { kind: 'novel-chapter', workId, prefs: { source: 'openai', model: 'm3' }, ...extra };
}

const llmBody = {
  source: 'openai',
  model: 'm3',
  messages: [{ role: 'user', content: '测试任务' }],
  params: {},
  thinking: false,
  label: '拆解',
};

/** mock 上游：OpenAI 兼容流式 SSE（旧 llm 任务 execute 走 runGenerate 需要真上游） */
function mockUpstream(text: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
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
    }),
  );
}

/**
 * 挂起式上游 mock（runner 实装后，novel-chapter 互斥/取消用例用它锁定 running 窗口——
 * 释放前上游不返回，任务停在执行期）。fixture 书（tw=2000 → 单段单调用）配对使用。
 */
function mockHoldUpstream(text = '挂起上游恢复后的章节正文。'): { release: () => void } {
  let hold = true;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      while (hold) await new Promise((r) => setTimeout(r, 20));
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
    }),
  );
  return {
    release: () => {
      hold = false;
    },
  };
}

/** fixture 书（novel-chapter 真实执行链需要 work.json + messages.jsonl；Task 3.3 起 runner 实装） */
async function seedWork(workId: string): Promise<void> {
  const work = {
    id: workId,
    revision: 1,
    title: 'm2 协议测试书',
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
    stats: { messageCount: 0, chapterCount: 0, charCount: 0 },
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Work;
  await writeJsonAtomic(join(worksDir(), workId, 'work.json'), work);
  await writeFile(join(worksDir(), workId, 'messages.jsonl'), '', 'utf8');
}

/** 任务落盘目录（与生产同源：tasksNovel.llmTasksDir 实时读 env DATA_DIR） */
function tasksDir(): string {
  return llmTasksDir();
}

/** 直写任务文件（预置 pending/running/终态现场，绕开执行器时序）；id 须为 36 位格式（:id 校验生效） */
async function seedTask(task: Record<string, unknown>): Promise<string> {
  await writeJsonAtomic(join(tasksDir(), `${task.id as string}.json`), task);
  return task.id as string;
}

/** 轮询直到任务离开 running（占位执行 throw 落盘 failed） */
async function waitFinished(a: ReturnType<typeof authed>, id: string): Promise<Record<string, unknown>> {
  let final: Record<string, unknown> = {};
  for (let i = 0; i < 40; i += 1) {
    const g = await a.get(`/api/llm/tasks/${id}`);
    final = g.body as Record<string, unknown>;
    if (final.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return final;
}

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-llm-tasks-m2-'));
  process.env.DATA_DIR = root;
  process.env.OPENAI_API_KEY = 'mock-key';
  await writeFile(join(root, 'secrets.json'), JSON.stringify({ openai: { apiKey: 'mock-key' } }), 'utf8');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.LLM_TASK_RETRY_DELAYS_MS;
  await rm(root, { recursive: true, force: true });
});

describe('novel-chapter 提交（schema union）', () => {
  it('提交 202，落盘文件含 kind/workId/prefs（mode/chapters default 生效）', async () => {
    await seedWork('w-seed');
    const hold = mockHoldUpstream(); // 锁定执行期窗口，落盘字段读取不受 runner 完成竞态影响
    const app = testApp();
    const sub = await authed(app).post('/api/llm/tasks').send(novelBody('w-seed', { chapters: 3 }));
    expect(sub.status).toBe(202);
    expect(sub.body.taskId).toBeTruthy();

    const file = await readJson<Record<string, unknown>>(join(tasksDir(), `${sub.body.taskId}.json`));
    expect(file).not.toBeNull();
    expect(file?.kind).toBe('novel-chapter');
    expect(file?.workId).toBe('w-seed');
    expect(file?.prefs).toEqual({ source: 'openai', model: 'm3' });
    expect(file?.mode).toBe('chapter');
    expect(file?.chapters).toBe(3);
    expect(['pending', 'running']).toContain(file?.status); // 提交落盘 pending，runner 首个进度写切 running

    hold.release();
    const final = await waitFinished(authed(app), sub.body.taskId);
    expect(final.status).toBe('done'); // runner 实装：3 章真实执行完成
    expect(final.resultMessages).toBe(3);
  });

  it('缺 prefs → 400（prefs 必填不 default）', async () => {
    const app = testApp();
    const noPrefs = await authed(app)
      .post('/api/llm/tasks')
      .send({ kind: 'novel-chapter', workId: 'w1' });
    expect(noPrefs.status).toBe(400);
  });
});

describe('同书互斥（权威层扫描）', () => {
  it('同书并发第二提交 → 409 GEN_BUSY', async () => {
    await seedWork('w-busy');
    const hold = mockHoldUpstream(); // 第一个任务停在执行期（文件保持 pending/running）
    const app = testApp();
    const a = authed(app);
    const first = await a.post('/api/llm/tasks').send(novelBody('w-busy'));
    expect(first.status).toBe(202);
    const second = await a.post('/api/llm/tasks').send(novelBody('w-busy'));
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('GEN_BUSY');
    expect(second.body.message).toBe('该书已有生成任务进行中');
    hold.release();
    await waitFinished(a, first.body.taskId); // 清理：放行至终态
  });

  it('cancel 置位后同书再提交仍 409（取消中任务占坑，防双任务竞态）', async () => {
    await seedWork('w-cancel-busy');
    const hold = mockHoldUpstream();
    const app = testApp();
    const a = authed(app);
    const first = await a.post('/api/llm/tasks').send(novelBody('w-cancel-busy'));
    expect(first.status).toBe(202);
    const cancel = await a.post(`/api/llm/tasks/${first.body.taskId}/cancel`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.ok).toBe(true);
    // cancelRequested=true 落盘
    const file = await readJson<Record<string, unknown>>(join(tasksDir(), `${first.body.taskId}.json`));
    expect(file?.cancelRequested).toBe(true);
    // 取消中（等当前段跑完）重提交 → 仍 409
    const second = await a.post('/api/llm/tasks').send(novelBody('w-cancel-busy'));
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('GEN_BUSY');
    hold.release();
    const final = await waitFinished(a, first.body.taskId);
    expect(final.status).toBe('done'); // 取消在段间生效：已产出即收束（D6）
  });

  it('不同书两个 novel-chapter 提交均成功（不互斥）', async () => {
    const app = testApp();
    const a = authed(app);
    const w1 = await a.post('/api/llm/tasks').send(novelBody('w-a'));
    const w2 = await a.post('/api/llm/tasks').send(novelBody('w-b'));
    expect(w1.status).toBe(202);
    expect(w2.status).toBe(202);
    expect(w1.body.taskId).not.toBe(w2.body.taskId);
  });
});

describe('POST /:id/cancel', () => {
  it('pending 任务置位 cancelRequested 落盘 → ok:true', async () => {
    const app = testApp();
    const id = await seedTask({
      id: '11111111-1111-4111-8111-111111111111', status: 'pending', kind: 'novel-chapter', workId: 'w-c1', createdAt: Date.now(),
    });
    const res = await authed(app).post(`/api/llm/tasks/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const file = await readJson<Record<string, unknown>>(join(tasksDir(), `${id}.json`));
    expect(file?.cancelRequested).toBe(true);
    expect(file?.status).toBe('pending'); // 只置标志，不改状态（取消执行在段间生效）
  });

  it('终态任务 → ok:false（200，不报错）', async () => {
    const app = testApp();
    const id = await seedTask({
      id: '22222222-2222-4222-8222-222222222222', status: 'done', kind: 'novel-chapter', workId: 'w-c2',
      text: '成品', createdAt: Date.now(), resultMessages: 1, resultMessageIds: ['m1'],
    });
    const res = await authed(app).post(`/api/llm/tasks/${id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });

  it('文件缺失 → 404 lost（与 GET /:id 对齐）；id 格式非法同样 404', async () => {
    const app = testApp();
    const a = authed(app);
    const res = await a.post('/api/llm/tasks/ffffffff-ffff-ffff-ffff-ffffffffffff/cancel');
    expect(res.status).toBe(404);
    expect(res.body.status).toBe('lost');
    const badId = await a.post('/api/llm/tasks/not-a-uuid/cancel');
    expect(badId.status).toBe(404);
    expect(badId.body.status).toBe('lost');
  });
});

describe('GET /active', () => {
  it('进行中任务入列（含 kind/workId/progressLen），终态后消失', async () => {
    await seedWork('w-active');
    const hold = mockHoldUpstream(); // 锁定执行期：active 列表读取不受完成竞态影响
    const app = testApp();
    const a = authed(app);
    const sub = await a.post('/api/llm/tasks').send(novelBody('w-active'));
    expect(sub.status).toBe(202);

    const listed = await a.get('/api/llm/tasks/active');
    expect(listed.status).toBe(200);
    const mine = (listed.body.tasks as Array<Record<string, unknown>>).find((t) => t.id === sub.body.taskId);
    expect(mine).toBeTruthy();
    expect(mine?.kind).toBe('novel-chapter');
    expect(mine?.workId).toBe('w-active');
    expect(mine?.progressLen).toBe(0); // 首章仍在执行（上游挂起），text 尚无累计
    expect(mine?.done).toBe(0);

    hold.release();
    const final = await waitFinished(a, sub.body.taskId);
    expect(final.status).toBe('done'); // runner 实装：真实执行完成
    const after = await a.get('/api/llm/tasks/active');
    const ids = (after.body.tasks as Array<{ id: string }>).map((t) => t.id);
    expect(ids).not.toContain(sub.body.taskId);
  });

  it('带 progress 的 running 任务：progressLen/done/chapterTotal/phase 透出', async () => {
    const app = testApp();
    await seedTask({
      id: '33333333-3333-4333-8333-333333333333', status: 'running', kind: 'novel-chapter', workId: 'w-active2',
      label: '连载', createdAt: Date.now(),
      progress: {
        chapterIndex: 2, chapterTotal: 5, phase: 'generating',
        text: '一二三四五六七八九十', done: 1, updatedAt: Date.now(),
      },
    });
    const listed = await authed(app).get('/api/llm/tasks/active');
    const mine = (listed.body.tasks as Array<Record<string, unknown>>).find((t) => t.id === '33333333-3333-4333-8333-333333333333');
    expect(mine?.progressLen).toBe(10);
    expect(mine?.done).toBe(1);
    expect(mine?.chapterTotal).toBe(5);
    expect(mine?.phase).toBe('generating');
    expect(mine?.label).toBe('连载');
  });
});

describe('GET /:id 协议扩展', () => {
  it('?since=N 增量切片：progressText=全文 slice(N) + 进度字段', async () => {
    const app = testApp();
    await seedTask({
      id: '44444444-4444-4444-8444-444444444444', status: 'running', kind: 'novel-chapter', workId: 'w-since',
      label: '增量', createdAt: Date.now(),
      progress: {
        chapterIndex: 3, chapterTotal: 8, phase: 'continuing',
        text: '一二三四五六七八九十', done: 2, updatedAt: Date.now(),
      },
    });
    const res = await authed(app).get('/api/llm/tasks/44444444-4444-4444-8444-444444444444?since=3');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'running',
      label: '增量',
      progressLen: 10,
      progressText: '四五六七八九十',
      done: 2,
      chapterTotal: 8,
      phase: 'continuing',
      chapterIndex: 3,
    });
  });

  it('?since=0 且无 progress：progressLen=0 / progressText 空 / 缺省进度', async () => {
    const app = testApp();
    await seedTask({ id: '55555555-5555-4555-8555-555555555555', status: 'running', createdAt: Date.now() });
    const res = await authed(app).get('/api/llm/tasks/55555555-5555-4555-8555-555555555555?since=0');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'running',
      progressLen: 0,
      progressText: '',
      done: 0,
      chapterTotal: 0,
      phase: 'assembling',
      chapterIndex: 0,
    });
  });

  it('since 非法值（负数/非数字）→ 忽略，走无 since 分支 {status:"running"}', async () => {
    const app = testApp();
    await seedTask({ id: '66666666-6666-4666-8666-666666666666', status: 'running', createdAt: Date.now() });
    for (const q of ['?since=-1', '?since=abc', '?since=1.5']) {
      const res = await authed(app).get(`/api/llm/tasks/66666666-6666-4666-8666-666666666666${q}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'running' });
    }
  });

  it('损坏 progress（缺 text 字段）→ since 分支不 500（progressLen 非空安全）', async () => {
    const app = testApp();
    await seedTask({
      id: '6a666666-6666-4666-8666-666666666666', status: 'running', createdAt: Date.now(),
      progress: { chapterIndex: 1, chapterTotal: 2, phase: 'generating', done: 0, updatedAt: Date.now() },
    });
    const res = await authed(app).get('/api/llm/tasks/6a666666-6666-4666-8666-666666666666?since=0');
    expect(res.status).toBe(200);
    expect(res.body.progressLen).toBe(0);
    expect(res.body.progressText).toBe('');
  });

  it(':id 格式非法 → 404 lost（defense-in-depth，不做无效落盘读）', async () => {
    const app = testApp();
    const res = await authed(app).get('/api/llm/tasks/not-a-valid-uuid');
    expect(res.status).toBe(404);
    expect(res.body.status).toBe('lost');
  });

  it('无 since → 响应形状与现状一致（恰为 {status:"running"}，旧消费方零感知）', async () => {
    const app = testApp();
    await seedTask({
      id: '77777777-7777-4777-8777-777777777777', status: 'running', kind: 'novel-chapter', workId: 'w-nosince',
      label: '标签', createdAt: Date.now(),
      progress: {
        chapterIndex: 1, chapterTotal: 2, phase: 'polishing',
        text: '正文', done: 0, updatedAt: Date.now(),
      },
    });
    const res = await authed(app).get('/api/llm/tasks/77777777-7777-4777-8777-777777777777');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'running' });
  });

  it('终态 done：现有形状之上附加 resultMessages/resultMessageIds', async () => {
    const app = testApp();
    await seedTask({
      id: '88888888-8888-4888-8888-888888888888', status: 'done', text: '全量正文', label: '连载',
      createdAt: Date.now(), resultMessages: 2, resultMessageIds: ['m-a', 'm-b'],
    });
    const res = await authed(app).get('/api/llm/tasks/88888888-8888-4888-8888-888888888888');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.text).toBe('全量正文');
    expect(res.body.label).toBe('连载');
    expect(res.body.resultMessages).toBe(2);
    expect(res.body.resultMessageIds).toEqual(['m-a', 'm-b']);
  });

  it('终态 done 无结果字段（旧形状文件）→ 不带 resultMessages/resultMessageIds', async () => {
    const app = testApp();
    await seedTask({ id: '99999999-9999-4999-8999-999999999999', status: 'done', text: '旧任务', createdAt: Date.now() });
    const res = await authed(app).get('/api/llm/tasks/99999999-9999-4999-8999-999999999999');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.text).toBe('旧任务');
    expect('resultMessages' in res.body).toBe(false);
    expect('resultMessageIds' in res.body).toBe(false);
  });
});

describe('并发写防线（终态/failed 落盘合并磁盘最新态）', () => {
  it('novel 执行期 cancel 后的终态写不抹掉 cancelRequested（progress 节流写同约束）', async () => {
    await seedWork('w-merge-novel');
    const hold = mockHoldUpstream();
    const app = testApp();
    const a = authed(app);
    const sub = await a.post('/api/llm/tasks').send(novelBody('w-merge-novel'));
    expect(sub.status).toBe(202);
    const cancel = await a.post(`/api/llm/tasks/${sub.body.taskId}/cancel`);
    expect(cancel.body.ok).toBe(true);
    hold.release(); // 取消标志已落盘后再放行，runner 终态写必须保留它
    const final = await waitFinished(a, sub.body.taskId);
    expect(final.status).toBe('done'); // 取消非失败：已产出即收束（D6）
    const file = await readJson<Record<string, unknown>>(join(tasksDir(), `${sub.body.taskId}.json`));
    expect(file?.cancelRequested).toBe(true); // 终态落盘合并 disk，取消标志保留
    expect(file?.progress).toBeUndefined(); // 终态清执行期增量
  });

  it('llm execute 终态写不抹掉执行期间置位的 cancelRequested', async () => {
    process.env.LLM_TASK_RETRY_DELAYS_MS = '600'; // 首轮上游 500 → 退避 600ms（窗口内置取消标志）
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        call += 1;
        if (call === 1) return new Response('boom', { status: 500 });
        const frames = [
          `data: ${JSON.stringify({ choices: [{ delta: { content: '重试后成功正文。' } }] })}\n\n`,
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
      }),
    );
    const app = testApp();
    const a = authed(app);
    const sub = await a.post('/api/llm/tasks').send(llmBody);
    expect(sub.status).toBe(202);
    await new Promise((r) => setTimeout(r, 150)); // 落在首轮失败后的退避窗口内
    const cancel = await a.post(`/api/llm/tasks/${sub.body.taskId}/cancel`);
    expect(cancel.body.ok).toBe(true);
    let final: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) {
      const g = await a.get(`/api/llm/tasks/${sub.body.taskId}`);
      final = g.body as Record<string, unknown>;
      if (final.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(final.status).toBe('done');
    const file = await readJson<Record<string, unknown>>(join(tasksDir(), `${sub.body.taskId}.json`));
    expect(file?.status).toBe('done');
    expect(file?.cancelRequested).toBe(true); // 终态写合并 disk，取消标志保留
  });
});

describe('向后兼容', () => {
  it('旧 llm 任务提交（无 kind 字段）不受影响：202 → done（mock 上游）', async () => {
    mockUpstream('旧任务结果全文。');
    const app = testApp();
    const a = authed(app);
    const sub = await a.post('/api/llm/tasks').send(llmBody);
    expect(sub.status).toBe(202);
    let final: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) {
      const g = await a.get(`/api/llm/tasks/${sub.body.taskId}`);
      final = g.body as Record<string, unknown>;
      if (final.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(final.status).toBe('done');
    expect(String(final.text)).toContain('旧任务结果全文');
    expect('resultMessages' in final).toBe(false); // 无结果字段不带新键
  });
});
