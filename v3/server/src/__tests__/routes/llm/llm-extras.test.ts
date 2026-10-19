/**
 * LLM 代理路由测试 — test / tokenize / 鉴权边界 / 非流式（TDD，Task 17）
 *
 * 覆盖：未登录 401 三端点边界、请求校验 400、POST /api/llm/test 探活、
 * POST /api/tokenize 计数（js-tiktoken 与字符启发式）、generate 非流式解析。
 * generate 流式通道见 llm.test.ts，共享装置见 llm-setup.ts。
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../../app';

import { GEN_BODY, loginCookie, withUpstream, seedSecrets } from './llm-setup';

describe('鉴权与请求校验', () => {
  it('未登录访问 generate / test / tokenize 一律 401', async () => {
    const app = createApp();
    expect((await request(app).post('/api/llm/generate').send(GEN_BODY)).status).toBe(401);
    expect((await request(app).post('/api/llm/test').send({ source: 'openai' })).status).toBe(401);
    expect((await request(app).post('/api/tokenize').send({ source: 'openai', text: 'hi' })).status).toBe(401);
  });

  it('generate 缺 messages → 400 人话错误', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/llm/generate')
      .set('Cookie', await loginCookie(app))
      .send({ source: 'openai', model: 'gpt-4o-mini' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});

describe('POST /api/llm/test 探活', () => {
  it('上游正常 → {ok:true}', async () => {
    await withUpstream(
      (_req, res, raw) => {
        expect(JSON.parse(raw).max_tokens).toBe(5);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }));
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/test')
          .set('Cookie', await loginCookie(app))
          .send({ source: 'openai' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
      },
    );
  });

  it('上游 401 → HTTP 200 + {ok:false, code:LLM_AUTH}', async () => {
    await withUpstream(
      (_req, res) => {
        res.writeHead(401).end('{"error":"bad"}');
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/test')
          .set('Cookie', await loginCookie(app))
          .send({ source: 'openai' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: false, code: 'LLM_AUTH' });
      },
    );
  });

  it('通道未配置密钥 → {ok:false, code:LLM_NOKEY}', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/llm/test')
      .set('Cookie', await loginCookie(app))
      .send({ source: 'claude' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, code: 'LLM_NOKEY' });
  });
});

describe('POST /api/llm/generate 非流式', () => {
  it.each([
    [
      'openai',
      { choices: [{ message: { content: '全文回复' } }] },
      (url: string) => expect(url).toBe('/v1/chat/completions'),
      '全文回复',
    ],
    [
      'claude',
      { content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] },
      (url: string) => expect(url).toBe('/v1/messages'),
      '第一段第二段',
    ],
    [
      'gemini',
      { candidates: [{ content: { parts: [{ text: '甲' }, { text: '乙' }] } }] },
      (url: string) => expect(url).toContain(':generateContent'),
      '甲乙',
    ],
  ] as const)('%s：完整响应解析为 {text}', async (source, payload, assertUrl, expected) => {
    await withUpstream(
      (req, res, raw) => {
        assertUrl(req.url ?? '');
        if (source === 'openai') expect(JSON.parse(raw).stream).toBeUndefined();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send({ ...GEN_BODY, source, model: 'test-model', stream: false });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ text: expected });
      },
    );
  });
});

describe('POST /api/tokenize', () => {
  it('openai（js-tiktoken）→ approximate:false 且 count>0', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/tokenize')
      .set('Cookie', await loginCookie(app))
      .send({ source: 'openai', model: 'gpt-4o', text: 'hello world, 你好世界' });
    expect(res.status).toBe(200);
    expect(res.body.approximate).toBe(false);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('openai o200k 系模型（gpt-4o/o1/o3/claude 名）与旧模型均可计数', async () => {
    const app = createApp();
    const cookie = await loginCookie(app);
    const a = await request(app)
      .post('/api/tokenize')
      .set('Cookie', cookie)
      .send({ source: 'openai', model: 'o3-mini', text: 'count me in' });
    const b = await request(app)
      .post('/api/tokenize')
      .set('Cookie', cookie)
      .send({ source: 'openai', model: 'gpt-3.5-turbo', text: 'count me in' });
    expect(a.body.approximate).toBe(false);
    expect(b.body.approximate).toBe(false);
    expect(a.body.count).toBeGreaterThan(0);
    expect(b.body.count).toBeGreaterThan(0);
  });

  it.each(['gemini', 'claude'])('%s → 字符启发式 approximate:true', async (source) => {
    const app = createApp();
    const res = await request(app)
      .post('/api/tokenize')
      .set('Cookie', await loginCookie(app))
      .send({ source, text: '你好世界 hello' });
    expect(res.status).toBe(200);
    expect(res.body.approximate).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('messages 输入（无 text）→ 合并全部 content 计数', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/tokenize')
      .set('Cookie', await loginCookie(app))
      .send({ source: 'gemini', messages: [{ content: '第一段' }, { content: '第二段' }] });
    expect(res.status).toBe(200);
    expect(res.body.approximate).toBe(true);
    const single = await request(app)
      .post('/api/tokenize')
      .set('Cookie', await loginCookie(app))
      .send({ source: 'gemini', text: '第一段\n第二段' });
    expect(res.body.count).toBe(single.body.count);
  });

  it('text 与 messages 都缺 → 400', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/tokenize')
      .set('Cookie', await loginCookie(app))
      .send({ source: 'openai' });
    expect(res.status).toBe(400);
  });
});
