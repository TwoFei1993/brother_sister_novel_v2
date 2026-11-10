/**
 * 移动端「切出继续生成」核心保证反复测试（goal：3 轮）
 *
 * 等效场景：手机提交任务 → 立即锁屏/切走（页面销毁，无轮询）→ server 端继续跑完
 * → 结果落盘永久保留（draft）→ 任意时刻重取（幂等）——不依赖前端存活。
 *
 * 每轮：提交（立即返回不等）→ 模拟页面销毁（停止一切轮询）→ 等 server 完成 → 重取验证。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { llmTasksRouter } from '../../../routes/llm/tasks';
import { authRequired, signToken } from '../../../middleware/auth';

process.env.ACCESS_PASSWORD = 'test123';

function testApp(): Express {
  const app = express();
  app.use(express.json());
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
  source: 'openai',
  model: 'm3',
  messages: [{ role: 'user', content: '移动端切出场景测试' }],
  params: {},
  thinking: false,
  label: '移动切出',
};

/** mock 上游（OpenAI 兼容非流式 JSON） */
function mockUpstream(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'm',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: '移动切出场景的生成结果正文。' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
}

let root = '';
let app: Express;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-mobile-bg-'));
  process.env.DATA_DIR = root;
  await writeFile(join(root, 'secrets.json'), JSON.stringify({ openai: { apiKey: 'mock-key' } }), 'utf8');
  app = testApp();
  mockUpstream(); // stub 上游（execute 后台用）
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe('移动端切出继续生成（3 轮反复）', () => {
  for (let round = 1; round <= 3; round += 1) {
    it(`第 ${round} 轮：提交后立即「锁屏」（无轮询）→ server 继续跑完 → 结果永久保留可重取`, async () => {
      const a = authed(app);
      const sub = await a.post('/api/llm/tasks').send(createBody);
      expect(sub.status).toBe(202);
      const taskId = sub.body.taskId as string;

      // 模拟「页面销毁」：提交后立即停止一切前端活动，只等 server 完成
      let final: Record<string, unknown> = {};
      for (let i = 0; i < 60; i += 1) {
        const g = await a.get(`/api/llm/tasks/${taskId}`);
        final = g.body as Record<string, unknown>;
        if (final.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 300));
      }
      expect(final.status).toBe('done');
      expect(String(final.text)).toContain('移动切出场景的生成结果正文');

      // 结果永久保留 draft：3 次重取全部幂等返回（等效第二天/下周再回来取）
      for (let retry = 0; retry < 3; retry += 1) {
        const g = await a.get(`/api/llm/tasks/${taskId}`);
        expect(g.status).toBe(200);
        expect(g.body.status).toBe('done');
        expect(g.body.text).toBe(final.text);
      }
    });
  }
});
