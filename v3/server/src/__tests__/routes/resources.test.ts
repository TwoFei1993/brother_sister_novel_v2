/**
 * 资源中心路由测试（TDD，Task 30）：GET index / builtin fetch / remote fetch。
 *
 * 自装配最小 express app（同 library.test.ts）；DATA_DIR 指向临时目录；
 * builtin 用例直接读仓库内 resources/builtin/ 真实文件（同时验证索引与文件一致）；
 * remote 用例用 vi.stubGlobal 模拟 fetch（超时/非法 JSON），不触真实网络：
 *   - 真实 https 慢服务器需证书，且 http://127.0.0.1 会被协议白名单先拒，
 *     故以 stub fetch + signal abort 模拟超时（与 undici TimeoutError 同语义）。
 * DNS lookup 一律 mock（review #4 SSRF 用例需注入私网解析结果，且 stub fetch 域名
 * 不应触发真实 DNS）：默认解析到公网 IP，私网用例逐次覆盖。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';
import { ZodError } from 'zod';

import { signToken } from '../../middleware/auth';
import { HttpError } from '../../middleware/validate';
import { libraryRouter } from '../../routes/library';
import { libraryDir } from '../../routes/library/crud';

// DNS lookup mock：默认公网地址（hoisted 供 vi.mock 工厂与用例内覆写共用）
const lookupMock = vi.hoisted(() =>
  vi.fn(async (_hostname: string, _options?: unknown) => [{ address: '93.184.216.34', family: 4 }]),
);
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

// ---------- 测试装置 ----------

let root = '';

const authed = (): { Cookie: string } => ({ Cookie: `token=${signToken()}` });

function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: '请求不合法' });
    return;
  }
  res.status(500).json({ error: '服务器内部错误' });
}

function makeApp(): Express {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api', libraryRouter);
  app.use(errorHandler);
  return app;
}

/** 永不完成、signal abort 时以 TimeoutError 拒绝的 fetch（模拟上游超时） */
function stubTimeoutFetch(): void {
  vi.stubGlobal(
    'fetch',
    (_url: unknown, init?: { signal?: AbortSignal }): Promise<never> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted due to timeout');
          err.name = 'TimeoutError';
          reject(err);
        });
      }),
  );
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-resources-'));
  process.env.DATA_DIR = root;
  process.env.RESOURCES_FETCH_TIMEOUT_MS = '200'; // 超时用例 0.2s 内返回
});

afterAll(async () => {
  delete process.env.RESOURCES_FETCH_TIMEOUT_MS;
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals(); // 每用例独立的 fetch stub，互不泄漏
});

// ---------- 用例 ----------

describe('GET /api/io/resources/index', () => {
  it('返回全量精选条目且字段完整（>0 条）', async () => {
    const res = await request(makeApp()).get('/api/io/resources/index').set(authed());
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(0);
    for (const e of res.body.entries) {
      expect(e.id).toBeTruthy();
      expect(['preset', 'worldbook', 'character', 'regex']).toContain(e.type);
      expect(e.name).toBeTruthy();
      expect(e.description).toBeTruthy();
      expect(['builtin', 'remote']).toContain(e.ref.kind);
      expect(e.license).toBeTruthy();
    }
  });
});

describe('POST /api/io/resources/fetch — builtin', () => {
  it('导入 Eldoria 世界书并入库，可回读 raw.entries', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'builtin', path: 'builtin/worldbooks/Eldoria.json' });
    expect(res.status).toBe(201);
    expect(res.body.assetType).toBe('worldbooks');
    expect(res.body.id).toBeTruthy();

    const back = await request(app).get(`/api/worldbooks/${res.body.id}`).set(authed());
    expect(back.status).toBe(200);
    expect(back.body.name).toBe('Eldoria');
    expect(Object.keys(back.body.raw.entries).length).toBeGreaterThan(0);
  });

  it('导入 sysprompt 文本冒险系统提示词 → 合成为最小预设入库', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'builtin', path: 'builtin/sysprompts/Text Adventure.json' });
    expect(res.status).toBe(201);
    expect(res.body.assetType).toBe('presets');
    expect(res.body.name).toBe('Text Adventure');

    const back = await request(app).get(`/api/presets/${res.body.id}`).set(authed());
    expect(back.status).toBe(200);
    expect(back.body.raw.prompts[0].identifier).toBe('sysprompt');
    expect(back.body.raw.prompts[0].content).toContain('Adventure Mode');
  });

  it('导入 Seraphina PNG 卡 → 角色入库并落底图', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'builtin', path: 'builtin/characters/default_Seraphina.png' });
    expect(res.status).toBe(201);
    expect(res.body.assetType).toBe('characters');
    expect(res.body.name).toContain('Seraphina');

    const back = await request(app).get(`/api/characters/${res.body.id}`).set(authed());
    expect(back.status).toBe(200);
    expect(back.body.avatar).toBe(`/data-assets/characters/${res.body.id}.png`);
    const png = await readFile(join(libraryDir('characters'), `${res.body.id}.png`));
    expect(png.subarray(0, 4).toString('latin1')).toBe('\x89PNG');
  });

  it('路径穿越（../ 与盘符）一律 400，白名单外路径 404', async () => {
    const app = makeApp();
    for (const path of ['../index.json', 'C:/Windows/system.ini', '..\\server\\src\\app.ts']) {
      const res = await request(app)
        .post('/api/io/resources/fetch')
        .set(authed())
        .send({ kind: 'builtin', path });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('非法');
    }
    const missing = await request(app)
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'builtin', path: 'builtin/not-exist.json' });
    expect(missing.status).toBe(404);
  });
});

describe('POST /api/io/resources/fetch — remote', () => {
  it('http:// 直链拒绝 400（仅允许 https）', async () => {
    const res = await request(makeApp())
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'remote', url: 'http://example.com/preset.json' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('https');
  });

  it('上游超时 → 504 人话错误', async () => {
    stubTimeoutFetch();
    const res = await request(makeApp())
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'remote', url: 'https://slow.example.com/preset.json' });
    expect(res.status).toBe(504);
    expect(res.body.error).toContain('超时');
  });

  it('上游返回非法 JSON → 400 人话错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('这不是 JSON', { status: 200 })),
    );
    const res = await request(makeApp())
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'remote', url: 'https://example.com/broken.json' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('不是合法的 JSON');
  });

  it('上游返回合法 JSON 但无法识别格式 → 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"hello":"world"}', { status: 200 })),
    );
    const res = await request(makeApp())
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'remote', url: 'https://example.com/unknown.json' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('无法识别');
  });
});

describe('remote 安全收口（review #4）', () => {
  const VALID_WORLDBOOK = JSON.stringify({
    entries: { '0': { uid: 0, key: ['魔法'], content: '这个世界存在魔法' } },
  });

  it('DNS 解析到私网/环回/链路本地地址 → 400 拒绝（SSRF 黑名单）', async () => {
    const blocked: Array<[string, number]> = [
      ['127.0.0.1', 4],
      ['10.1.2.3', 4],
      ['172.16.0.9', 4],
      ['192.168.1.1', 4],
      ['169.254.9.9', 4],
      ['100.64.0.1', 4],
      ['::1', 6],
      ['fd12::1', 6],
      ['fe80::1', 6],
      ['::ffff:127.0.0.1', 6],
    ];
    for (const [address, family] of blocked) {
      lookupMock.mockResolvedValueOnce([{ address, family }]);
      const res = await request(makeApp())
        .post('/api/io/resources/fetch')
        .set(authed())
        .send({ kind: 'remote', url: 'https://evil.example.com/preset.json' });
      expect(res.status, `地址 ${address} 应被拒绝`).toBe(400);
      expect(res.body.error).toContain('内网');
    }
  });

  it('公网解析 + 合法 JSON → 正常导入（黑名单不误伤公网）', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(VALID_WORLDBOOK, { status: 200 })));
    const res = await request(makeApp())
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'remote', url: 'https://ok.example.com/wb.json' });
    expect(res.status).toBe(201);
    expect(res.body.assetType).toBe('worldbooks');
  });

  it('域名无法解析 → 400', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const res = await request(makeApp())
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'remote', url: 'https://no-such.example.com/wb.json' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('无法解析');
  });

  it('响应体超 20MB → 流式中止 413（不整包下载）', async () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(big, { status: 200 })));
    const res = await request(makeApp())
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'remote', url: 'https://big.example.com/huge.json' });
    expect(res.status).toBe(413);
    expect(res.body.error).toContain('20MB');
  });

  it('302 重定向到 http:// → 400 拒绝（重定向不豁免协议校验）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(null, { status: 302, headers: { location: 'http://insecure.example.com/preset.json' } }),
      ),
    );
    const res = await request(makeApp())
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'remote', url: 'https://redirect.example.com/a.json' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('https');
  });

  it('302 重定向到公网 https → 跟随一跳并以最终 URL 导入成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://final.example.com/preset.json' } }),
      )
      .mockResolvedValueOnce(new Response(VALID_WORLDBOOK, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await request(makeApp())
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'remote', url: 'https://start.example.com/a.json' });
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain('final.example.com');
  });

  it('重定向超过 3 跳 → 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://next.example.com/b.json' } })),
    );
    const res = await request(makeApp())
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'remote', url: 'https://loop.example.com/a.json' });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('3 跳');
  });
});
