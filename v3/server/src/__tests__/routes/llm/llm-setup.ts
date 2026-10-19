/**
 * LLM 代理路由测试共享装置（从 llm.test.ts 提取，llm.test.ts / llm-extras.test.ts 共用）
 *
 * 上游用本地 node:http 假服务器 mock；secrets.json 由测试直写（baseUrl 覆盖）；
 * 数据落在 os.tmpdir() 随机临时目录；超时用 LLM_UPSTREAM_TIMEOUT_MS env 注入。
 * 模块被任一测试文件导入时即在其实例注册生命周期钩子（vitest 文件级隔离，互不干扰）。
 */
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AddressInfo } from 'node:net';
import request from 'supertest';
import type { Express } from 'express';

export const PASSWORD = 'llm-test';
export const KEYS = { openai: 'sk-test-key-001', gemini: 'gem-test-key-002', claude: 'claude-test-key-003' };

let dataDir = '';

/** 当前测试数据目录（beforeAll 后有效） */
export function dataDirPath(): string {
  return dataDir;
}

type UpstreamHandler = (req: IncomingMessage, res: ServerResponse, raw: string) => void;

/** 起一个随机端口的本地假上游，用完自动关闭 */
export async function withUpstream(handler: UpstreamHandler, fn: (baseUrl: string) => Promise<void>): Promise<void> {
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
export async function seedSecrets(baseUrl: string): Promise<void> {
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

/** 直写单通道 secrets.json（自定义 baseUrl，不可达用例用） */
export async function seedRawSecrets(channel: string, secret: object): Promise<void> {
  await writeFile(join(dataDir, 'secrets.json'), JSON.stringify({ [channel]: secret }), 'utf8');
}

/** 登录拿合法 cookie */
export async function loginCookie(app: Express): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ password: PASSWORD });
  const joined = String(res.headers['set-cookie']);
  return `token=${joined.match(/token=([^;]+)/)![1]}`;
}

/** 解析 SSE 文本为 data 载荷序列 */
export function sseFrames(text: string): string[] {
  return text
    .split('\n\n')
    .filter((f) => f.startsWith('data:'))
    .map((f) => f.slice(5).trim());
}

/** 写 openai 风格 SSE 流：两段增量 + [DONE] */
export function writeOpenaiStream(res: ServerResponse, parts: string[]): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const p of parts) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

/** 生成请求公共体（流式 openai） */
export const GEN_BODY = {
  source: 'openai',
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: '你好' }],
  stream: true,
};

// ---- 生命周期（随导入方测试文件各自注册运行）----

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
