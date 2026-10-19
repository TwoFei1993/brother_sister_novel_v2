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
import type { Message } from '@shared/message';
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
  return { id, role: 'user', name: '用户', content, createdAt: 1, swipes: [content], swipeId: 0, extra: {} };
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
    target.swipes = Array.from({ length: 20 }, (_, i) => `v${i + 1}`);
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.swipeRegenerate(baseWork(), [target], target);
    });
    expect(result).toBeNull();
    expect(useGenerationStore.getState().error).toMatchObject({ code: 'SWIPE_LIMIT' });
    expect(useGenerationStore.getState().error?.message).toContain('20');
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
    expect(result!.swipes).toEqual(['旧候选正文XYZ', '新候选']); // 候选追加同 id upsert
  });
});
