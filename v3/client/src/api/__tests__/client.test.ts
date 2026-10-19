/**
 * api client 冒烟测试：ApiError 语义 / 401 跳转钩子 / SSE 解析（jsdom 环境）
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiFetch, apiStream, setUnauthorizedHandler } from '../client';

afterEach(() => {
  setUnauthorizedHandler(null); // 恢复默认 401 行为
  vi.restoreAllMocks();
});

/** 构造 SSE 流式响应 */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('apiFetch', () => {
  it('错误响应解析 {error} 为人话消息与对应 code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: '密码错误' }), { status: 401 })),
    );
    const err = await apiFetch('/api/auth/login', { keepOn401: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('密码错误');
    expect((err as ApiError).code).toBe('unauthorized');
  });

  it('401 非 auth 路径触发跳转钩子', async () => {
    const on401 = vi.fn();
    setUnauthorizedHandler(on401);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: '未登录' }), { status: 401 })),
    );
    await apiFetch('/api/works').catch(() => undefined);
    expect(on401).toHaveBeenCalledWith('/api/works');
  });

  it('401 auth 自身路径不触发跳转（避免登录页循环）', async () => {
    const on401 = vi.fn();
    setUnauthorizedHandler(on401);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: '未登录' }), { status: 401 })),
    );
    await apiFetch('/api/auth/check').catch(() => undefined);
    expect(on401).not.toHaveBeenCalled();
  });

  it('POST 字符串 body 自动补 application/json 请求头', async () => {
    const fetchMock = vi.fn(
      async (_path: string, init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'x' }) });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('网络不可达抛 code=network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const err = await apiFetch('/api/ping').catch((e) => e);
    expect((err as ApiError).code).toBe('network');
  });
});

describe('apiStream', () => {
  it('按 data: 行解析事件，[DONE] 正常结束', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"好"}}]}\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const events: unknown[] = [];
    await apiStream('/api/llm/generate', {}, (e) => events.push(e));
    expect(events).toHaveLength(2);
    expect((events[0] as { choices: [{ delta: { content: string } }] }).choices[0].delta.content).toBe('你');
  });

  it('跨 chunk 截断的半行能正确拼回解析', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(['data: {"a":', '1}\ndata: [', 'DONE]\n']),
      ),
    );
    const events: unknown[] = [];
    await apiStream('/api/llm/generate', {}, (e) => events.push(e));
    expect(events).toEqual([{ a: 1 }]);
  });

  it('非 2xx 抛 ApiError 并带人话消息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: '密钥无效' }), { status: 502 })),
    );
    const err = await apiStream('/api/llm/generate', {}, () => undefined).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('密钥无效');
    expect((err as ApiError).code).toBe('serverError');
  });

  it('非法 JSON 行静默跳过不中断', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([': heartbeat\n', 'data: not-json\n', 'data: {"ok":true}\n', 'data: [DONE]\n'])),
    );
    const events: unknown[] = [];
    await apiStream('/api/llm/generate', {}, (e) => events.push(e));
    expect(events).toEqual([{ ok: true }]);
  });

  it('流结束但未见 [DONE] → 抛 streamIncomplete（防静默断流当正常完成，review #1）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: {"a":1}\n\n'])));
    const events: unknown[] = [];
    const err = await apiStream('/api/llm/generate', {}, (e) => events.push(e)).catch((e) => e);
    expect(events).toEqual([{ a: 1 }]); // 已收到的事件照常分发
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('streamIncomplete');
  });
});
