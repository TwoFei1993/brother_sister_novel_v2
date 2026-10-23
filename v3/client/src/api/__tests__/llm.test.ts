/**
 * LLM 生成流 API 测试：buildGenerateBody 组装 / generateStream SSE 帧分发 / tokenizeMessages
 * fetch 模块级 stub（jsdom），SSE 响应体用 ReadableStream 构造。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildGenerateBody, extractFinishReason, generateStream, tokenizeMessages } from '../llm';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 构造 SSE 流式响应（与 client.test.ts 同模式） */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('buildGenerateBody', () => {
  it('组装 source/model/messages 并默认 stream:true', () => {
    const body = buildGenerateBody({
      source: 'openai',
      model: 'gpt-4o',
      messages: [{ role: 'system', content: 'hi' }],
    });
    expect(body).toEqual({
      source: 'openai',
      model: 'gpt-4o',
      messages: [{ role: 'system', content: 'hi' }],
      stream: true,
    });
  });

  it('采样参数映射进 params：temperature 原名、maxTokens→max_tokens', () => {
    const body = buildGenerateBody({
      source: 'claude',
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'x' }],
      temperature: 0.7,
      maxTokens: 2048,
    });
    expect(body.params).toEqual({ temperature: 0.7, max_tokens: 2048 });
  });

  it('thinking:true（D4）写入 params.thinking；false/缺省不携带该字段', () => {
    const on = buildGenerateBody({
      source: 'claude',
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'x' }],
      thinking: true,
    });
    expect(on.params?.thinking).toBe(true);
    const off = buildGenerateBody({
      source: 'claude',
      model: 'MiniMax-M3',
      messages: [{ role: 'user', content: 'x' }],
      thinking: false,
    });
    expect(off.params?.thinking).toBeUndefined();
  });

  it('无采样参数时不携带 params 字段', () => {
    const body = buildGenerateBody({
      source: 'gemini',
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(body).not.toHaveProperty('params');
  });

  it('stream:false 可显式关闭（非流式预留）', () => {
    const body = buildGenerateBody({
      source: 'openai',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
      stream: false,
    });
    expect(body.stream).toBe(false);
  });
});

describe('generateStream', () => {
  it('text 帧逐条 onChunk，[DONE] 结束后 onDone 恰一次', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"text":"第一"}\n\n',
          'data: {"text":"段"}\n\n',
          'data: {"text":"文字"}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const chunks: string[] = [];
    let doneCount = 0;
    await generateStream(
      { source: 'openai', model: 'gpt-4o', messages: [], stream: true },
      {
        onChunk: (t) => chunks.push(t),
        onDone: () => {
          doneCount += 1;
        },
        onError: vi.fn(),
      },
    );
    expect(chunks).toEqual(['第一', '段', '文字']);
    expect(doneCount).toBe(1);
  });

  it('error 帧分发 onError（携带 code/message），不误触发 onChunk', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(['data: {"error":{"code":"LLM_AUTH","message":"密钥无效"}}\n\n', 'data: [DONE]\n\n']),
      ),
    );
    const onChunk = vi.fn();
    const onError = vi.fn();
    await generateStream(
      { source: 'openai', model: 'x', messages: [], stream: true },
      { onChunk, onDone: vi.fn(), onError },
    );
    expect(onChunk).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({ code: 'LLM_AUTH', message: '密钥无效' });
  });

  it('thinking 帧（D4）分发 onThinking，不误触发 onChunk', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"thinking":"先想兄妹动机："}\n\n',
          'data: {"thinking":"复仇还是逃离"}\n\n',
          'data: {"text":"雨夜。"}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    );
    const onChunk = vi.fn();
    const onThinking = vi.fn();
    await generateStream(
      { source: 'claude', model: 'MiniMax-M3', messages: [], stream: true },
      { onChunk, onThinking, onDone: vi.fn(), onError: vi.fn() },
    );
    expect(onThinking.mock.calls.map((c) => c[0])).toEqual(['先想兄妹动机：', '复仇还是逃离']);
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith('雨夜。');
  });

  it('text 与 thinking 同帧共存时两个回调都被调用（按上游形状透传）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['data: {"text":"正文","thinking":"边写边想"}\n\n', 'data: [DONE]\n\n'])),
    );
    const onChunk = vi.fn();
    const onThinking = vi.fn();
    await generateStream(
      { source: 'claude', model: 'x', messages: [], stream: true },
      { onChunk, onThinking, onDone: vi.fn(), onError: vi.fn() },
    );
    expect(onChunk).toHaveBeenCalledWith('正文');
    expect(onThinking).toHaveBeenCalledWith('边写边想');
  });

  it('未传 onThinking（缺省）时 thinking 帧被安全忽略，不影响 text/onDone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['data: {"thinking":"思考"}\n\n', 'data: {"text":"正文"}\n\n', 'data: [DONE]\n\n'])),
    );
    const chunks: string[] = [];
    let doneCount = 0;
    await generateStream(
      { source: 'openai', model: 'x', messages: [], stream: true },
      { onChunk: (t) => chunks.push(t), onDone: () => { doneCount += 1; }, onError: vi.fn() },
    );
    expect(chunks).toEqual(['正文']);
    expect(doneCount).toBe(1);
  });

  it('上游非 2xx（未开流）向上抛 ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 'LLM_QUOTA', message: '额度不足' }), { status: 502 })),
    );
    await expect(
      generateStream({ source: 'openai', model: 'x', messages: [], stream: true }, {
        onChunk: vi.fn(),
        onDone: vi.fn(),
        onError: vi.fn(),
      }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('静默断流：流结束但无 [DONE] → 抛 streamIncomplete，不调 onDone（review #1）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['data: {"text":"半"}\n\n', 'data: {"text":"成品"}\n\n'])),
    );
    const chunks: string[] = [];
    const onDone = vi.fn();
    await expect(
      generateStream(
        { source: 'openai', model: 'x', messages: [], stream: true },
        { onChunk: (t) => chunks.push(t), onDone, onError: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: 'streamIncomplete' });
    expect(chunks).toEqual(['半', '成品']); // 已产出内容照常分发（供 partialKept 保留）
    expect(onDone).not.toHaveBeenCalled(); // 不得被当正常完成
  });

  it('0 chunk 静默断流同样抛 streamIncomplete（不含任何 data 帧）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([': heartbeat\n\n'])));
    const onChunk = vi.fn();
    await expect(
      generateStream(
        { source: 'openai', model: 'x', messages: [], stream: true },
        { onChunk, onDone: vi.fn(), onError: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: 'streamIncomplete' });
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('读流中途连接异常（未收到 [DONE]）→ streamIncomplete，不误报 unknown', async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode('data: {"text":"半"}\n\n'));
                controller.error(new TypeError('network interrupted'));
              },
            }),
            { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
          ),
      ),
    );
    const onDone = vi.fn();
    await expect(
      generateStream(
        { source: 'openai', model: 'x', messages: [], stream: true },
        { onChunk: vi.fn(), onDone, onError: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: 'streamIncomplete' });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('signal 中止时向上抛 AbortError', async () => {
    // 永不结束的流：abort 后 read 拒绝
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_path: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      ),
    );
    const controller = new AbortController();
    const pending = generateStream(
      { source: 'openai', model: 'x', messages: [], stream: true },
      { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('tokenizeMessages', () => {
  it('POST /api/tokenize，body 携带 source/model 与各消息 content', async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        new Response(JSON.stringify({ count: 42, approximate: false }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await tokenizeMessages('openai', 'gpt-4o', [
      { role: 'system', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
    expect(result).toEqual({ count: 42, approximate: false });
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/tokenize');
    expect(JSON.parse(String(init.body))).toEqual({
      source: 'openai',
      model: 'gpt-4o',
      messages: [{ content: 'a' }, { content: 'b' }],
    });
  });

  it('model 缺省时不携带 model 字段', async () => {
    const fetchMock = vi.fn(
      async (): Promise<Response> =>
        new Response(JSON.stringify({ count: 1, approximate: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await tokenizeMessages('gemini', undefined, [{ role: 'user', content: 'x' }]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      source: 'gemini',
      messages: [{ content: 'x' }],
    });
  });
});

describe('extractFinishReason（上游 raw 透传的结束原因——截断自动续写的决定性信号）', () => {
  it('openai 形态：choices[0].finish_reason=length → length', () => {
    expect(extractFinishReason({ choices: [{ delta: {}, finish_reason: 'length' }] })).toBe('length');
    expect(extractFinishReason({ choices: [{ delta: {}, finish_reason: 'stop' }] })).toBe('stop');
  });

  it('claude 形态：delta.stop_reason / 顶层 stop_reason=max_tokens → max_tokens', () => {
    expect(extractFinishReason({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } })).toBe('max_tokens');
    expect(extractFinishReason({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })).toBe('end_turn');
    expect(extractFinishReason({ stop_reason: 'max_tokens' })).toBe('max_tokens');
  });

  it('无 raw / 非对象 / 无结束字段 → null（不误触发）', () => {
    expect(extractFinishReason(undefined)).toBeNull();
    expect(extractFinishReason('junk')).toBeNull();
    expect(extractFinishReason({ choices: [{ delta: { content: 'x' } }] })).toBeNull();
  });
});
