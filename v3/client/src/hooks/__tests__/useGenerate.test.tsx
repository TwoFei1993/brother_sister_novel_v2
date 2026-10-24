/**
 * useGenerate 集成测试（jsdom + createRoot harness，review #1/#10/#13 行为验证）
 *
 * fetch 模块级 stub：/api/llm/generate（SSE）/ /api/tokenize / /api/works/:id/messages。
 * 覆盖：静默断流 fail+partialKept 不入库（review #1）/ 正常流入库回归（#7 行为等价）/
 * swipe 重 roll 上限拒绝（review #13）/ 上下文取 target 之前（review #10）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiVersion, type Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import { useGenerationStore } from '../../stores/generation';
import { useSettingsStore } from '../../stores/settings';

import { buildChapterMessage } from '../generation-flow';
import { useGenerate } from '../useGenerate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 构造 SSE 流式响应（与 api 层测试同模式） */
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

function jsonRes(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

function baseWork(): Work {
  return {
    id: 'w1',
    revision: 1,
    title: '测试作品',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: defaultNovelSettings,
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function userMsg(id: string, content: string): Message {
  return { id, role: 'user', name: '用户', content, createdAt: 1, swipes: [aiVersion(content, 'v1', 1)], swipeId: 0, extra: {} };
}

// ---------- fetch stub：按路径分发并记录调用 ----------
type FetchCall = { path: string; init: RequestInit };
let calls: FetchCall[] = [];

function stubFetch(route: (path: string, init: RequestInit) => Response | undefined): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const full: FetchCall = { path, init: init ?? {} };
      calls.push(full);
      const res = route(path, full.init);
      if (res) return res;
      throw new Error(`unmocked fetch: ${path}`);
    }),
  );
}

/** 常规 stub：生成流 + tokenize + messages 入库（生成体由用例指定） */
function stubDefaultRoute(generateChunks: string[]): void {
  stubFetch((path, init) => {
    if (path === '/api/llm/generate') return sseResponse(generateChunks);
    if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
    if (path === '/api/works/w1/messages') {
      void init; // 入库 POST，直接成功
      return jsonRes({ ok: true, revision: 2 });
    }
    return undefined;
  });
}

// ---------- hook harness（createRoot + Probe 组件，与组件测试同模式） ----------
const roots: Root[] = [];
let latest: ReturnType<typeof useGenerate> | null = null;

function Probe(): null {
  latest = useGenerate();
  return null;
}

async function renderHook(): Promise<void> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<Probe />);
  });
}

beforeEach(() => {
  calls = [];
  useGenerationStore.getState().reset();
  useSettingsStore.getState().setLlmPrefs({ source: 'openai', model: 'gpt-4o' });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
  useGenerationStore.getState().reset();
});

describe('useGenerate（review #1 断流事务）', () => {
  it('静默断流（无 [DONE]）：已产出半成品 → fail+partialKept=true，不 finalize 入库', async () => {
    stubDefaultRoute(['data: {"text":"半"}\n\n', 'data: {"text":"成品"}\n\n']); // 无 [DONE]
    await renderHook();
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.generateChapter(baseWork(), [], '写第一章');
    });
    expect(result).toBeNull();
    const store = useGenerationStore.getState();
    expect(store.error).toMatchObject({ code: 'streamIncomplete' });
    expect(store.partialKept).toBe(true);
    expect(store.buffer).toBe('半成品'); // 半成品保留在界面供「继续」
    expect(store.streaming).toBe(false);
    expect(calls.some((c) => c.path.endsWith('/messages'))).toBe(false); // 半成品不入库
  });

  it('正常流（含 [DONE]）→ 章节消息幂等入库一次，store 复位（#7 重构行为等价回归）', async () => {
    stubDefaultRoute(['data: {"text":"第一段"}\n\n', 'data: [DONE]\n\n']);
    await renderHook();
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.generateChapter(baseWork(), [], '写第一章');
    });
    expect(result).not.toBeNull();
    expect(result!.content).toBe('第一段');
    expect(result!.role).toBe('assistant');
    expect(result!.chapter?.index).toBe(1);
    expect(calls.filter((c) => c.path.endsWith('/messages'))).toHaveLength(1);
    const store = useGenerationStore.getState();
    expect(store.error).toBeNull();
    expect(store.buffer).toBe(''); // finish+reset 收束
  });
});

describe('useGenerate.swipeRegenerate（review #13 上限 / #10 上下文截断）', () => {
  it('swipes 满 20 → 拒绝并提示 SWIPE_LIMIT，不发起任何请求', async () => {
    stubFetch(() => undefined); // 任何请求都算失败——断言根本不该发
    await renderHook();
    const target = buildChapterMessage({
      content: 'v1',
      title: '一',
      chapterIndex: 1,
      promptTokens: 1,
      generationMs: 1,
    });
    target.swipes = Array.from({ length: 50 }, (_, i) => aiVersion(`第${i + 1}支`, `v${i + 1}`, i));
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.swipeRegenerate(baseWork(), [target], target);
    });
    expect(result).toBeNull();
    expect(useGenerationStore.getState().error).toMatchObject({ code: 'SWIPE_LIMIT' });
    expect(useGenerationStore.getState().error?.message).toContain('50');
    expect(useGenerationStore.getState().partialKept).toBe(false);
    expect(calls).toHaveLength(0); // 未发任何流/入库请求
  });

  it('重 roll 上下文取 target 之前：旧候选正文不进生成请求，新候选追加进 swipes', async () => {
    const prev = userMsg('u1', '前面的剧情');
    const target = buildChapterMessage({
      content: '旧候选正文XYZ',
      title: '二',
      chapterIndex: 2,
      directive: '写第二章',
      promptTokens: 1,
      generationMs: 1,
    });
    let captured: { messages: { content: string }[] } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({ path, init: init ?? {} });
        if (path === '/api/llm/generate') {
          captured = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
          return sseResponse(['data: {"text":"新候选"}\n\n', 'data: [DONE]\n\n']);
        }
        if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
        if (path === '/api/works/w1/messages') return jsonRes({ ok: true, revision: 2 });
        throw new Error(`unmocked fetch: ${path}`);
      }),
    );
    await renderHook();
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.swipeRegenerate(baseWork(), [prev, target], target);
    });
    expect(result).not.toBeNull();
    expect(captured).not.toBeNull();
    const allText = JSON.stringify(captured!.messages);
    expect(allText).not.toContain('旧候选正文XYZ'); // 被重 roll 的旧候选不进上下文（review #10）
    expect(allText).toContain('前面的剧情'); // 之前的历史保留
    expect(result!.swipes.map((v) => v.content)).toEqual(['旧候选正文XYZ', '新候选']); // 候选追加同 id upsert
  });
});

describe('useGenerate.swipeRegenerate（连续两次重roll 回归——用户实测「第二次消失」）', () => {
  it('连续两次重roll：候选累加不丢失（v1→[v1,A]→[v1,A,B]，swipeId 指向最新）', async () => {
    let n = 0;
    stubFetch((path, init) => {
      calls.push({ path, init: init ?? {} });
      if (path === '/api/llm/generate') {
        n += 1;
        return sseResponse([`data: {"text":"重roll候选${n}"}\n\n`, 'data: [DONE]\n\n']);
      }
      if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
      if (path === '/api/works/w1/messages') return jsonRes({ ok: true, revision: 2 });
      throw new Error(`unmocked fetch: ${path}`);
    });
    await renderHook();
    const prev = userMsg('u1', '前面的剧情');
    let target = buildChapterMessage({
      content: 'v1', title: '一', chapterIndex: 1, directive: '写第一章', promptTokens: 1, generationMs: 1,
    });
    let all = [prev, target];
    let r: Message | null = null;
    await act(async () => {
      r = await latest!.swipeRegenerate(baseWork(), all, target);
    });
    expect(r!.swipes.map((v) => v.content)).toEqual(['v1', '重roll候选1']);
    all = [prev, r!];
    await act(async () => {
      r = await latest!.swipeRegenerate(baseWork(), all, r!);
    });
    // 第二次重roll：候选累加不覆盖（自动命名 v2/v3），swipeId 指向最新候选
    expect(r!.swipes.map((v) => v.content)).toEqual(['v1', '重roll候选1', '重roll候选2']);
    expect(r!.swipeId).toBe(2);
    expect(r!.content).toBe('重roll候选2');
  });
});

describe('useGenerate（元信息残章自动重试——质检T4「第二次消失」根因）', () => {
  it('首次产物只有思考没有正文 → 自动带重试后缀再生成一次，最终返回有效正文', async () => {
    // 注意：calls 由 stubFetch wrapper 统一记录，route 回调内不得再 push（否则同一请求双重计数）
    let genCalls = 0;
    let retryBody: { messages: { content: string }[] } | null = null;
    stubFetch((path, init) => {
      if (path === '/api/llm/generate') {
        genCalls += 1;
        if (genCalls === 1) {
          return sseResponse(['data: {"text":"<thinking>只写了思考</thinking>"}\n\n', 'data: [DONE]\n\n']);
        }
        retryBody = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
        return sseResponse(['data: {"text":"这次是完整正文，剧情推进顺利。"}\n\n', 'data: [DONE]\n\n']);
      }
      if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
      if (path === '/api/works/w1/messages') return jsonRes({ ok: true, revision: 2 });
      throw new Error(`unmocked fetch: ${path}`);
    });
    await renderHook();
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.generateChapter(baseWork(), [], '写第一章');
    });
    expect(genCalls).toBe(2); // 自动重试恰好一次
    // 重试后缀在 directive 消息上；末尾一条是输出守卫 system 消息（novel 组装固定追加）
    expect(retryBody!.messages.at(-2)!.content).toContain('系统重试');
    expect(retryBody!.messages.at(-1)!.content).toContain('输出守卫');
    expect(result!.content).toBe('这次是完整正文，剧情推进顺利。'); // 最终为有效正文
  });

  it('首次即有效正文 → 不触发重试（单次调用）', async () => {
    // 注意：calls 由 stubFetch wrapper 统一记录，route 回调内不得再 push（否则同一请求双重计数）
    stubFetch((path) => {
      if (path === '/api/llm/generate') return sseResponse(['data: {"text":"正常正文"}\n\n', 'data: [DONE]\n\n']);
      if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
      if (path === '/api/works/w1/messages') return jsonRes({ ok: true, revision: 2 });
      throw new Error(`unmocked fetch: ${path}`);
    });
    await renderHook();
    await act(async () => {
      await latest!.generateChapter(baseWork(), [], '写第一章');
    });
    expect(calls.filter((c) => c.path === '/api/llm/generate')).toHaveLength(1);
  });

  it('重试后仍残章（两次流都只回 thinking）→ 返回 null 且不入库（占位章不上架）', async () => {
    stubFetch((path) => {
      if (path === '/api/llm/generate') {
        return sseResponse(['data: {"text":"<thinking>只写了思考</thinking>"}\n\n', 'data: [DONE]\n\n']);
      }
      if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
      if (path === '/api/works/w1/messages') return jsonRes({ ok: true, revision: 2 });
      throw new Error(`unmocked fetch: ${path}`);
    });
    await renderHook();
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.generateChapter(baseWork(), [], '写第一章');
    });
    expect(calls.filter((c) => c.path === '/api/llm/generate')).toHaveLength(2); // 重试恰好一次
    expect(result).toBeNull(); // 重试后仍残章：返回 null（batch 以 null 终止、不 upsert）
    expect(calls.filter((c) => c.path === '/api/works/w1/messages')).toHaveLength(0); // 占位不入库
  });
});

describe('useGenerate（D4 thinking_delta 全链路：💭折叠真实内容）', () => {
  it('thinking 帧 → runtime 累积 thinkingBuffer → finalize 优先写入 extra.rawThinking，正文干净', async () => {
    stubDefaultRoute([
      'data: {"thinking":"先想兄妹动机：是复仇还是逃离。"}\n\n',
      'data: {"thinking":"选逃离，留悬念。"}\n\n',
      'data: {"text":"# 第1章 雨夜\\n妹妹攥紧了哥哥的袖口。"}\n\n',
      'data: [DONE]\n\n',
    ]);
    await renderHook();
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.generateChapter(baseWork(), [], '写第一章');
    });
    expect(result).not.toBeNull();
    // 流式累积的思考优先入库（MiniMax M3 不写 <think> 标签，这是💭折叠的唯一真实数据源）
    expect(result!.extra.rawThinking).toBe('先想兄妹动机：是复仇还是逃离。选逃离，留悬念。');
    expect(result!.content).not.toContain('先想兄妹动机'); // 思考不混入正文
    expect(result!.content).toContain('妹妹攥紧了哥哥的袖口。');
    // store 收束：finish+reset 后 thinkingBuffer 一并复位（不串味到下一章）
    expect(useGenerationStore.getState().thinkingBuffer).toBe('');
  });

  it('正文内嵌 <think> 标签仍走 extractThinking 兜底；流式+标签同时存在时拼接不丢内容', async () => {
    stubDefaultRoute([
      'data: {"thinking":"流式思考"}\n\n',
      'data: {"text":"<think>标签思考</think>正文开始。"}\n\n',
      'data: [DONE]\n\n',
    ]);
    await renderHook();
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.generateChapter(baseWork(), [], '写第一章');
    });
    // openai 通道下 <think> 内联标签由 runtime 分流器实时并入思考流（mergeThinking 只剩单源）
    expect(result!.extra.rawThinking).toBe('流式思考标签思考');
    expect(result!.content).toBe('正文开始。'); // 标签剥离干净
  });

  it('无 thinking 帧且正文无标签 → extra.rawThinking 不落空串（字段缺省）', async () => {
    stubDefaultRoute(['data: {"text":"纯净正文。"}\n\n', 'data: [DONE]\n\n']);
    await renderHook();
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.generateChapter(baseWork(), [], '写第一章');
    });
    expect(result!.extra.rawThinking).toBeUndefined();
  });
});
