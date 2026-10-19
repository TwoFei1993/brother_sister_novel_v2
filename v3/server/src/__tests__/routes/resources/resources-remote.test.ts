/**
 * 资源中心路由测试 — remote fetch 与安全收口（TDD，Task 30 / review #4）
 *
 * remote 用例用 vi.stubGlobal 模拟 fetch（超时/非法 JSON/重定向），不触真实网络：
 *   - 真实 https 慢服务器需证书，且 http://127.0.0.1 会被协议白名单先拒，
 *     故以 stub fetch + signal abort 模拟超时（与 undici TimeoutError 同语义）。
 * 覆盖：协议白名单、SSRF 私网黑名单、DNS 失败、20MB 限长、重定向校验与跟随。
 * index 与 builtin 见 resources.test.ts，装置见 resources-setup.ts。
 */
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { authed, makeApp, rejectDnsLookup, setDnsResolution, stubTimeoutFetch } from './resources-setup';

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
      setDnsResolution(address, family);
      const res = await request(makeApp())
        .post('/api/io/resources/fetch')
        .set(authed())
        .send({ kind: 'remote', url: 'https://evil.example.com/preset.json' });
      expect(res.status, `地址 ${address} 应被拒绝`).toBe(400);
      expect(res.body.error).toContain('内网');
    }
  });

  it('公网解析 + 合法 JSON → 正常导入（黑名单不误伤公网）', async () => {
    setDnsResolution('93.184.216.34', 4);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(VALID_WORLDBOOK, { status: 200 })));
    const res = await request(makeApp())
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'remote', url: 'https://ok.example.com/wb.json' });
    expect(res.status).toBe(201);
    expect(res.body.assetType).toBe('worldbooks');
  });

  it('域名无法解析 → 400', async () => {
    rejectDnsLookup('ENOTFOUND');
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
