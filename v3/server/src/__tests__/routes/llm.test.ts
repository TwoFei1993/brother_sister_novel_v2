/**
 * LLM 代理路由测试（TDD，Task 17）：generate（SSE/非流式）/ test / tokenize
 *
 * 上游用本地 node:http 假服务器 mock 三通道（SSE 流、错误码、挂起）；
 * secrets.json 由测试直写（gemini/claude 的 baseUrl 覆盖能力供中转站与测试使用，
 * PUT /api/secrets 的 schema 不开放该字段，直写绕过 schema 属预期）。
 * 数据落在 os.tmpdir() 随机临时目录；超时用 LLM_UPSTREAM_TIMEOUT_MS env 注入。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AddressInfo } from 'node:net';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../app';

const PASSWORD = 'llm-test';
const KEYS = { openai: 'sk-test-key-001', gemini: 'gem-test-key-002', claude: 'claude-test-key-003' };
let dataDir = '';

type UpstreamHandler = (req: IncomingMessage, res: ServerResponse, raw: string) => void;

/** 起一个随机端口的本地假上游，用完自动关闭 */
async function withUpstream(handler: UpstreamHandler, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => handler(req, res, raw));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(baseUrl);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
}

/** 直写 secrets.json：三通道密钥都指向 mock 上游（baseUrl 覆盖） */
async function seedSecrets(baseUrl: string): Promise<void> {
  await writeFile(
    join(dataDir, 'secrets.json'),
    JSON.stringify({
      openai: { apiKey: KEYS.openai, baseUrl: `${baseUrl}/v1` },
      gemini: { apiKey: KEYS.gemini, baseUrl },
      claude: { apiKey: KEYS.claude, baseUrl },
    }),
    'utf8',
  );
}

/** 登录拿合法 cookie */
async function loginCookie(app: Express): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ password: PASSWORD });
  const joined = String(res.headers['set-cookie']);
  return `token=${joined.match(/token=([^;]+)/)![1]}`;
}

/** 解析 SSE 文本为 data 载荷序列 */
function sseFrames(text: string): string[] {
  return text
    .split('\n\n')
    .filter((f) => f.startsWith('data:'))
    .map((f) => f.slice(5).trim());
}

/** 写 openai 风格 SSE 流：两段增量 + [DONE] */
function writeOpenaiStream(res: ServerResponse, parts: string[]): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const p of parts) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

const GEN_BODY = {
  source: 'openai',
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: '你好' }],
  stream: true,
};

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'v3-llm-'));
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  process.env.ACCESS_PASSWORD = PASSWORD;
  process.env.DATA_DIR = dataDir;
  await rm(join(dataDir, 'secrets.json'), { force: true });
});

afterEach(() => {
  delete process.env.LLM_UPSTREAM_TIMEOUT_MS;
});

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
    await writeFile(
      join(dataDir, 'secrets.json'),
      JSON.stringify({ openai: { apiKey: KEYS.openai, baseUrl: 'http://127.0.0.1:1/v1' } }),
      'utf8',
    );
    const res = await request(app)
      .post('/api/llm/generate')
      .set('Cookie', await loginCookie(app))
      .send(GEN_BODY);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('LLM_NET');
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
