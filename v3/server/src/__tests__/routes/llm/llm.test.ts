/**
 * LLM 代理路由测试 — generate 通道（TDD，Task 17）
 *
 * 覆盖：SSE 流式三通道解析 / 客户端断开联动 / 非流式解析 / 上游错误翻译（§9.1）。
 * test/tokenize/鉴权边界见 llm-extras.test.ts，共享装置见 llm-setup.ts。
 */
import { describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import { type AddressInfo } from 'node:net';
import request from 'supertest';

import { createApp } from '../../../app';

import {
  GEN_BODY,
  KEYS,
  loginCookie,
  seedRawSecrets,
  seedSecrets,
  sseFrames,
  withUpstream,
  writeOpenaiStream,
} from './llm-setup';

describe('POST /api/llm/generate 流式（SSE）', () => {
  it('openai：上游 SSE 增量解析为统一帧 {text, raw}，最后 [DONE]', async () => {
    await withUpstream(
      (req, res) => {
        expect(req.url).toBe('/v1/chat/completions');
        expect(req.headers.authorization).toBe(`Bearer ${KEYS.openai}`);
        writeOpenaiStream(res, ['你好', '，世界']);
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send(GEN_BODY);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
        const frames = sseFrames(res.text);
        expect(frames).toHaveLength(3);
        expect(JSON.parse(frames[0])).toEqual({
          text: '你好',
          raw: { choices: [{ delta: { content: '你好' } }] },
        });
        expect(JSON.parse(frames[1]).text).toBe('，世界');
        expect(frames[2]).toBe('[DONE]');
        expect(res.text).not.toContain(KEYS.openai);
      },
    );
  });

  it('claude：content_block_delta 提取 delta.text，message_stop 收束为 [DONE]', async () => {
    await withUpstream(
      (req, res) => {
        expect(req.url).toBe('/v1/messages');
        expect(req.headers['x-api-key']).toBe(KEYS.claude);
        expect(req.headers['anthropic-version']).toBe('2023-06-01');
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: '早安' } })}\n\n`,
        );
        res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        res.end();
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send({ ...GEN_BODY, source: 'claude', model: 'claude-3-5-haiku-latest' });
        const frames = sseFrames(res.text);
        expect(JSON.parse(frames[0])).toMatchObject({ text: '早安' });
        expect(frames.at(-1)).toBe('[DONE]');
      },
    );
  });

  it('claude thinking_delta（D4）：上游思考帧透传为 SSE {"thinking":…}，正文帧形状不变（MiniMax M3 主路径）', async () => {
    await withUpstream(
      (req, res, raw) => {
        // thinking:true → 服务端组装 extended-thinking 参数开启上游思考（MiniMax 默认关闭）
        const body = JSON.parse(raw) as { thinking?: { type?: string; budget_tokens?: number } };
        expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 }); // max_tokens 8192 → 一半
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        // 官方协议：content_block_delta + delta.type='thinking_delta'，内容在 delta.thinking
        res.write(
          `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '先想兄妹动机：' } })}\n\n`,
        );
        // 部分兼容实现写作 delta.type='thinking'
        res.write(
          `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'thinking', thinking: '复仇还是逃离' } })}\n\n`,
        );
        // 正文不受影响
        res.write(
          `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: '雨夜。' } })}\n\n`,
        );
        res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        res.end();
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send({
            ...GEN_BODY,
            source: 'claude',
            model: 'MiniMax-M3',
            params: { max_tokens: 8192, thinking: true },
          });
        const frames = sseFrames(res.text);
        const parse = (f: string): Record<string, unknown> => JSON.parse(f) as Record<string, unknown>;
        expect(parse(frames[0]!)).toEqual({
          thinking: '先想兄妹动机：',
          raw: expect.anything(),
        }); // 纯思考帧：只带 thinking 不带 text
        expect(parse(frames[1]!)).toEqual({ thinking: '复仇还是逃离', raw: expect.anything() });
        expect(parse(frames[2]!)).toEqual({ text: '雨夜。', raw: expect.anything() }); // 正文帧形状不变
        expect(frames).toHaveLength(4); // message_stop 在服务端直接收束，不产生帧
        expect(frames.at(-1)).toBe('[DONE]');
      },
    );
  });

  it('gemini thought part（D4）：thought:true 的 part 进 thinking 帧不混入正文', async () => {
    await withUpstream(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({
            candidates: [{ content: { parts: [{ text: '梳理线索', thought: true }] } }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '正文开始' }] } }] })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send({ ...GEN_BODY, source: 'gemini', model: 'gemini-2.5-flash' });
        const frames = sseFrames(res.text);
        const parse = (f: string): Record<string, unknown> => JSON.parse(f) as Record<string, unknown>;
        expect(parse(frames[0]!)).toMatchObject({ thinking: '梳理线索' });
        expect(parse(frames[0]!)).not.toHaveProperty('text'); // 思考不混入正文
        expect(parse(frames[1]!)).toMatchObject({ text: '正文开始' });
        expect(frames.at(-1)).toBe('[DONE]');
      },
    );
  });

  it('gemini：candidates parts 文本合并为增量帧，密钥仅在 query 不回传', async () => {
    await withUpstream(
      (req, res) => {
        expect(req.url ?? '').toContain(':streamGenerateContent?alt=sse');
        expect(req.url ?? '').toContain(`key=${KEYS.gemini}`);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '晚上' }] } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '好' }] } }] })}\n\n`);
        res.end();
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send({ ...GEN_BODY, source: 'gemini', model: 'gemini-1.5-flash' });
        const frames = sseFrames(res.text);
        expect(JSON.parse(frames[0]).text).toBe('晚上');
        expect(JSON.parse(frames[1]).text).toBe('好');
        expect(frames.at(-1)).toBe('[DONE]');
        expect(res.text).not.toContain(KEYS.gemini);
      },
    );
  });

  it('上游流中途断开：已发帧保留 + 错误帧 LLM_NET，HTTP 200 收尾', async () => {
    await withUpstream(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '写到一半' } }] })}\n\n`);
        setTimeout(() => res.destroy(), 20);
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send(GEN_BODY);
        expect(res.status).toBe(200);
        const frames = sseFrames(res.text);
        expect(JSON.parse(frames[0]).text).toBe('写到一半');
        const last = JSON.parse(frames.at(-1)!);
        expect(last.error.code).toBe('LLM_NET');
      },
    );
  });

  it('上游发首帧后挂起超时 → 部分帧 + LLM_TIMEOUT error 帧 + HTTP 200（流中异常不破坏帧协议，review #5）', async () => {
    process.env.LLM_UPSTREAM_TIMEOUT_MS = '150';
    await withUpstream(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '开头' } }] })}\n\n`);
        // 之后永久挂起：由服务端超时中止，必须以 error 帧收尾而非 502 JSON
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send(GEN_BODY);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
        const frames = sseFrames(res.text);
        expect(JSON.parse(frames[0]).text).toBe('开头');
        const last = JSON.parse(frames.at(-1)!);
        expect(last.error.code).toBe('LLM_TIMEOUT');
        expect(res.text).not.toContain('[DONE]'); // 异常收尾不发正常完成帧
      },
    );
  });
});

describe('客户端断开联动（review #6）', () => {
  it('客户端提前断开 → 服务端中止上游请求（上游侧连接被关闭）', async () => {
    let upstreamClosed = false;
    let notifyClosed: (() => void) | undefined;
    const upstreamClosedPromise = new Promise<void>((ok) => (notifyClosed = ok));
    await withUpstream(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.on('close', () => {
          upstreamClosed = true;
          notifyClosed?.();
        });
        const timer = setInterval(() => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`);
          }
        }, 10);
        res.on('close', () => clearInterval(timer));
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const cookie = await loginCookie(app);
        // supertest 无法中途断开，改用原生 http 请求 + 手动 destroy
        const server = app.listen(0, '127.0.0.1');
        await new Promise<void>((ok) => server.once('listening', () => ok()));
        const port = (server.address() as AddressInfo).port;
        const client = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: '/api/llm/generate',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
          },
          (r) => {
            r.once('data', () => client.destroy()); // 收到首个 SSE 块即断开
          },
        );
        client.write(JSON.stringify(GEN_BODY));
        client.end();
        await Promise.race([upstreamClosedPromise, new Promise<void>((ok) => setTimeout(ok, 3000))]);
        expect(upstreamClosed).toBe(true); // 上游感知到连接关闭 = 服务端已中止请求
        server.closeAllConnections?.();
        await new Promise<void>((ok) => server.close(() => ok()));
      },
    );
  });
});

describe('上游错误翻译（设计 §9.1）', () => {
  const cases: Array<[number, string, string]> = [
    [401, '{"error":"bad key"}', 'LLM_AUTH'],
    [429, '{"error":"rate limited"}', 'LLM_QUOTA'],
    [400, '{"error":"content blocked by safety filter"}', 'LLM_REJECTED'],
    [500, 'upstream boom', 'LLM_NET'],
  ];
  it.each(cases)('openai 上游 %i → %s（未开流 502 JSON）', async (status, body, code) => {
    await withUpstream(
      (_req, res) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body);
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send(GEN_BODY);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe(code);
        expect(res.body.message).toBeTruthy();
        expect(res.text).not.toContain(KEYS.openai);
      },
    );
  });

  it('gemini 上游 401：错误响应不含 query 里的密钥（URL 脱敏）', async () => {
    await withUpstream(
      (_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"error":"unauthenticated"}');
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send({ ...GEN_BODY, source: 'gemini', model: 'gemini-1.5-flash' });
        expect(res.body.code).toBe('LLM_AUTH');
        expect(res.text).not.toContain(KEYS.gemini);
      },
    );
  });

  it('上游挂起超过时限 → LLM_TIMEOUT', async () => {
    process.env.LLM_UPSTREAM_TIMEOUT_MS = '80';
    await withUpstream(
      (_req, res) => {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.end();
        }, 2000);
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send(GEN_BODY);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('LLM_TIMEOUT');
      },
    );
  });

  it('上游地址不可达（连接拒绝）→ LLM_NET', async () => {
    const app = createApp();
    await seedRawSecrets('openai', { apiKey: KEYS.openai, baseUrl: 'http://127.0.0.1:1/v1' });
    const res = await request(app)
      .post('/api/llm/generate')
      .set('Cookie', await loginCookie(app))
      .send(GEN_BODY);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('LLM_NET');
  });
});

describe('上游空闲超时（反馈⑩：chunk 持续到达不误报）', () => {
  it('慢流：chunk 间隔 100ms < 空闲超时 200ms、总时长 ~1s 超过旧总时长语义 → 完整收到不超时', async () => {
    process.env.LLM_UPSTREAM_TIMEOUT_MS = '200';
    await withUpstream(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        let i = 0;
        const timer = setInterval(() => {
          if (i >= 10) {
            clearInterval(timer);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `第${i}段` } }] })}\n\n`);
          i += 1;
        }, 100);
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send(GEN_BODY);
        expect(res.status).toBe(200);
        const frames = sseFrames(res.text);
        expect(JSON.parse(frames[0]!).text).toBe('第0段');
        expect(JSON.parse(frames[9]!).text).toBe('第9段');
        expect(frames.at(-1)).toBe('[DONE]');
        expect(res.text).not.toContain('LLM_TIMEOUT');
      },
    );
  });

  it('总时长硬顶：chunk 持续到达（不触发空闲超时）但超过硬顶 → LLM_TIMEOUT error 帧', async () => {
    process.env.LLM_UPSTREAM_TIMEOUT_MS = '500'; // 空闲 500ms，chunk 每 30ms → 不触发
    process.env.LLM_UPSTREAM_TOTAL_TIMEOUT_MS = '300';
    await withUpstream(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const timer = setInterval(() => {
          if (res.writableEnded || res.destroyed) {
            clearInterval(timer);
            return;
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`);
        }, 30);
        res.on('close', () => clearInterval(timer));
      },
      async (baseUrl) => {
        const app = createApp();
        await seedSecrets(baseUrl);
        const res = await request(app)
          .post('/api/llm/generate')
          .set('Cookie', await loginCookie(app))
          .send(GEN_BODY);
        expect(res.status).toBe(200);
        const last = JSON.parse(sseFrames(res.text).at(-1)!);
        expect(last.error.code).toBe('LLM_TIMEOUT');
        expect(last.error.message).toContain('硬顶');
        expect(res.text).not.toContain('[DONE]');
      },
    );
  });
});
