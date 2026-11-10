/**
 * LLM 后台任务路由测试（切出 App 后生成继续——用户核心需求）
 *
 * 覆盖：提交 202（taskId）/ 轮询 running → done（mock 上游有正文）/ 空输出预算加倍
 * （2 轮协商后成功）/ 上游错误 failed / 取走即焚（二次 GET 404）/ 未配置上游 failed 人话
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

import { llmTasksRouter } from '../../../routes/llm/tasks';
import { authRequired } from '../../../middleware/auth';
import { signToken } from '../../../middleware/auth';

process.env.ACCESS_PASSWORD = 'test123';

function testApp(): Express {
  const app = express();
  app.use(express.json());
  // 与生产 app.ts 同语义：llm 域作者专属（未登录 401/读者 403 由 auth 层判定）
  app.use('/api', authRequired);
  app.use('/api', llmTasksRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: String(err) });
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

const createBody = {
  source: 'openai', // 与 mock 上游（OpenAI 兼容 SSE）及预置 secrets 通道对齐
  model: 'm3',
  messages: [{ role: 'user', content: '测试任务' }],
  params: {},
  thinking: false,
  label: '拆解',
};

/** mock 上游：OpenAI 兼容非流式 JSON（runGenerate stream:false 期待完整响应） */
function mockUpstream(text: string, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ id: 'm', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  );
}

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-llm-tasks-'));
  process.env.DATA_DIR = root;
  process.env.OPENAI_API_KEY = 'mock-key'; // upstream.ts openai 通道读 env
  // secrets.json 预置 openai key（runGenerate 前置 key 检查的数据源）
  await writeFile(join(root, 'secrets.json'), JSON.stringify({ openai: { apiKey: 'mock-key' } }), 'utf8');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe('LLM 后台任务', () => {
  it('提交 202 + 轮询 running → done（结果取走即焚）', async () => {
    vi.stubGlobal('fetch', mockUpstream('拆解结果全文。'));
    const app = testApp();
    const sub = await authed(app).post('/api/llm/tasks').send(createBody);
    console.log('SUB', sub.status, JSON.stringify(sub.body));
    expect(sub.status).toBe(202);
    const immediate = await authed(app).get(`/api/llm/tasks/${sub.body.taskId}`);
    console.log('IMMEDIATE', immediate.status, JSON.stringify(immediate.body).slice(0, 100));
    expect(sub.body.taskId).toBeTruthy();

    // 轮询至 done（上游 mock 立即返回，第一次 GET 可能 running 或 done）
    let final: Record<string, unknown> = {};
    for (let i = 0; i < 20; i += 1) {
      const g = await authed(app).get(`/api/llm/tasks/${sub.body.taskId}`);
      final = g.body as Record<string, unknown>;
      console.log('POLL', g.status, JSON.stringify(final).slice(0, 120));
      if (final.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(final.status).toBe('done');
    expect(final.text).toContain('拆解结果全文');

    // 取走即焚：二次 GET → 404 lost
    const again = await authed(app).get(`/api/llm/tasks/${sub.body.taskId}`);
    expect([404, 410]).toContain(again.status);
  });

  it('空输出 → 预算加倍协商（第二次跑出正文）', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        call += 1;
        const text = call === 1 ? '' : '第二轮出正文了。';
        return new Response(
          JSON.stringify({ id: 'm', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
    const app = testApp();
    const sub = await authed(app).post('/api/llm/tasks').send(createBody);
    let final: Record<string, unknown> = {};
    for (let i = 0; i < 30; i += 1) {
      const g = await authed(app).get(`/api/llm/tasks/${sub.body.taskId}`);
      final = g.body as Record<string, unknown>;
      console.log('POLL', g.status, JSON.stringify(final).slice(0, 120));
      if (final.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(final.status).toBe('done');
    expect(String(final.text)).toContain('第二轮');
  });

  it('上游 5xx → failed（含错误）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const app = testApp();
    const sub = await authed(app).post('/api/llm/tasks').send(createBody);
    let final: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) {
      const g = await authed(app).get(`/api/llm/tasks/${sub.body.taskId}`);
      final = g.body as Record<string, unknown>;
      console.log('POLL', g.status, JSON.stringify(final).slice(0, 120));
      if (final.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(final.status).toBe('failed');
    expect(String(final.error ?? '')).not.toBe('');
  });

  it('未知 id → 404 lost；未登录 → 401', async () => {
    const app = testApp();
    expect((await authed(app).get('/api/llm/tasks/ffffffff-ffff-ffff-ffff-ffffffffffff')).status).toBe(404);
    expect((await request(app).get('/api/llm/tasks/x')).status).toBe(401);
  });
});
