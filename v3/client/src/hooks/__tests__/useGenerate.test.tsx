/**
 * useGenerate 集成测试（jsdom + createRoot harness）
 *
 * M2 Chunk 4 任务化迁移：generateChapter 走 server novel-chapter 任务——mock 层从 SSE 流
 * 改为任务响应序列（POST 202 → GET ?since 增量 → done+resultMessageIds）。分段/无效输出
 * 重试/截断续写/崩溃补救语义已上移 server 编排（server 端 novel-gen 测试覆盖），客户端锁：
 * 提交参数契约 / 增量回流 / 终态同步 / 409 与 failed 槽 fail。
 * swipeRegenerate 仍走 client SSE 链（Chunk 5 切换）——原 SSE mock 测试保留。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiVersion, type Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import { getGenSlot, useGenerationStore } from '../../stores/generation';
import { useSettingsStore } from '../../stores/settings';
import { useWorkStore } from '../../stores/work';

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

function jsonRes(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
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

function chapterMsg(id: string, index: number, content: string): Message {
  return {
    id,
    role: 'assistant',
    name: '小说家',
    content,
    createdAt: 1,
    swipes: [aiVersion(content, 'v1', 1)],
    swipeId: 0,
    extra: {},
    chapter: { index, title: `第${index}章` },
  };
}

// ---------- fetch stub：按路径分发并记录调用 ----------
type FetchCall = { path: string; init: RequestInit };
let calls: FetchCall[] = [];
/** 任务路径脚本：提交状态码 / 轮询响应序列 / 终态取回的入库消息 */
let submitStatus = 202;
let pollScript: Array<Record<string, unknown>> = [];
let pollIdx = 0;
let storedMessages: Message[] = [];

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

/** 任务路径 stub：提交 + 增量轮询 + messages 拉取（generateChapter 任务化后的 mock 形态） */
function stubTaskRoute(): void {
  stubFetch((path, init) => {
    if (path === '/api/llm/tasks' && (init.method ?? 'GET') === 'POST') {
      if (submitStatus === 409) return jsonRes({ code: 'GEN_BUSY', message: '该书已有生成任务进行中' }, 409);
      return jsonRes({ taskId: 't1' }, 202);
    }
    if (path.startsWith('/api/llm/tasks/t1?since=') || path === '/api/llm/tasks/t1') {
      const item = pollScript[Math.min(pollIdx, pollScript.length - 1)];
      pollIdx += 1;
      return jsonRes(item);
    }
    if (path.startsWith('/api/works/w1/messages?')) return jsonRes({ messages: storedMessages });
    return undefined;
  });
}

async function drainPolls(ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
  }
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
  submitStatus = 202;
  pollScript = [];
  pollIdx = 0;
  storedMessages = [];
  useGenerationStore.setState({ slots: {} });
  useWorkStore.setState({ messages: [] });
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
  useGenerationStore.setState({ slots: {} });
  useWorkStore.setState({ messages: [] });
});

describe('useGenerate.generateChapter（M2 Chunk 4：server novel-chapter 任务路径）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('提交任务（kind/mode/directive/chapters/prefs 全量含 repetitionPenalty）→ done 同步入库消息并返回末章', async () => {
    pollScript = [
      { status: 'running', progressLen: 3, progressText: '第一', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 1 },
      { status: 'done', resultMessages: 1, resultMessageIds: ['m9'] },
    ];
    storedMessages = [chapterMsg('m9', 1, '第一章正文。')];
    stubTaskRoute();
    useSettingsStore.getState().setLlmPrefs({ temperature: 0.7, repetitionPenalty: 1.15, polishModel: 'polisher' });
    await renderHook();
    let result: Message | null | undefined;
    act(() => {
      void latest!.generateChapter(baseWork(), [], '写第一章').then((r) => {
        result = r;
      });
    });
    await drainPolls(2);
    // 提交体契约：prefs 非敏感字段全量透传（repetitionPenalty 治重复循环防线不可漏）
    const submit = calls.find((c) => c.path === '/api/llm/tasks')!;
    expect(submit.init.method).toBe('POST');
    const body = JSON.parse(String(submit.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ kind: 'novel-chapter', workId: 'w1', mode: 'chapter', directive: '写第一章', chapters: 1 });
    expect(body.prefs).toMatchObject({
      source: 'openai',
      model: 'gpt-4o',
      temperature: 0.7,
      repetitionPenalty: 1.15,
      polishModel: 'polisher',
      thinking: true,
    });
    // 终态同步：返回入库末章 + 本地视图 upsertLocal
    expect(result).not.toBeNull();
    expect(result!.id).toBe('m9');
    expect(result!.content).toBe('第一章正文。');
    expect(result!.chapter?.index).toBe(1);
    expect(useWorkStore.getState().messages.map((m) => m.id)).toEqual(['m9']);
    expect(getGenSlot('w1')?.error ?? null).toBeNull();
  });

  it('任务 failed → 返回 null + 槽 fail（含 server 原因），已完成章仍同步', async () => {
    pollScript = [
      { status: 'running', progressLen: 4, progressText: '写到', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 1 },
      { status: 'failed', error: '第 1 章生成失败：上游超时', resultMessages: 0, resultMessageIds: [] },
    ];
    stubTaskRoute();
    await renderHook();
    let result: Message | null | undefined;
    act(() => {
      void latest!.generateChapter(baseWork(), [], '写第一章').then((r) => {
        result = r;
      });
    });
    await drainPolls(2);
    expect(result).toBeNull();
    expect(getGenSlot('w1')?.error).toMatchObject({ code: 'LLM_FAILED' });
    expect(getGenSlot('w1')?.error?.message).toContain('上游超时');
  });

  it('409 GEN_BUSY（同书已有任务）→ 槽 fail「该书已有生成任务进行中」，无轮询请求', async () => {
    submitStatus = 409;
    stubTaskRoute();
    await renderHook();
    let result: Message | null | undefined;
    act(() => {
      void latest!.generateChapter(baseWork(), [], '写第一章').then((r) => {
        result = r;
      });
    });
    await drainPolls(1); // flush 提交 promise（fake timers 下推进一拍即冲刷微任务）
    expect(result).toBeNull();
    expect(getGenSlot('w1')?.error).toEqual({ code: 'GEN_BUSY', message: '该书已有生成任务进行中' });
    expect(calls.some((c) => c.path.startsWith('/api/llm/tasks/t1'))).toBe(false);
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
    expect(getGenSlot('w1')?.error).toMatchObject({ code: 'SWIPE_LIMIT' });
    expect(getGenSlot('w1')?.error?.message).toContain('50');
    expect(getGenSlot('w1')?.partialKept).toBe(false);
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
          return sseResponse(['data: {"text":"新候选"}\n\n', 'data: {"finish":"stop"}\n\n', 'data: [DONE]\n\n']);
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
    expect(result!.swipes.map((v) => v.content)).toEqual(['旧候选正文XYZ', '新候选。']); // 候选追加同 id upsert
  });
});

describe('useGenerate.swipeRegenerate（连续两次重roll 回归——用户实测「第二次消失」）', () => {
  it('连续两次重roll：候选累加不丢失（v1→[v1,A]→[v1,A,B]，swipeId 指向最新）', async () => {
    let n = 0;
    stubFetch((path, init) => {
      calls.push({ path, init: init ?? {} });
      if (path === '/api/llm/generate') {
        n += 1;
        return sseResponse([`data: {"text":"重roll候选${n}"}\n\n`, 'data: {"finish":"stop"}\n\n', 'data: [DONE]\n\n']);
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
    expect(r!.swipes.map((v) => v.content)).toEqual(['v1', '重roll候选1。']);
    all = [prev, r!];
    await act(async () => {
      r = await latest!.swipeRegenerate(baseWork(), all, r!);
    });
    // 第二次重roll：候选累加不覆盖（自动命名 v2/v3），swipeId 指向最新候选
    expect(r!.swipes.map((v) => v.content)).toEqual(['v1', '重roll候选1。', '重roll候选2。']);
    expect(r!.swipeId).toBe(2);
    expect(r!.content).toBe('重roll候选2。');
  });
});

describe('useGenerate（D4 thinking_delta 全链路：💭折叠真实内容——swipe 链回归）', () => {
  /** swipe 链共用 stub：generateChapter 已切任务，thinking 管线由仍走 client SSE 的 swipe 路径覆盖 */
  function stubSwipeRoute(textFrames: string[]): void {
    stubFetch((path) => {
      if (path === '/api/llm/generate') return sseResponse([...textFrames, 'data: {"finish":"stop"}\n\n', 'data: [DONE]\n\n']);
      if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
      if (path === '/api/works/w1/messages') return jsonRes({ ok: true, revision: 2 });
      throw new Error(`unmocked fetch: ${path}`);
    });
  }

  /** swipe 目标（重 roll 走 appendSwipe 通道，thinking 管线与 chapter 路径同源） */
  function swipeTarget(): Message {
    return buildChapterMessage({
      content: 'v1',
      title: '一',
      chapterIndex: 1,
      directive: '写第一章',
      promptTokens: 1,
      generationMs: 1,
    });
  }

  it('thinking 帧 → runtime 累积 thinkingBuffer → finalize 优先写入 extra.rawThinking，正文干净', async () => {
    stubSwipeRoute([
      'data: {"thinking":"先想兄妹动机：是复仇还是逃离。"}\n\n',
      'data: {"thinking":"选逃离，留悬念。"}\n\n',
      'data: {"text":"雨夜里妹妹攥紧了哥哥的袖口。"}\n\n',
    ]);
    await renderHook();
    const target = swipeTarget();
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.swipeRegenerate(baseWork(), [target], target);
    });
    expect(result).not.toBeNull();
    // 流式累积的思考优先入库（MiniMax M3 不写 <think> 标签，这是💭折叠的唯一真实数据源）
    expect(result!.extra.rawThinking).toBe('先想兄妹动机：是复仇还是逃离。选逃离，留悬念。');
    expect(result!.content).not.toContain('先想兄妹动机'); // 思考不混入正文
    expect(result!.content).toContain('妹妹攥紧了哥哥的袖口。');
    // store 收束：finish+reset 后 thinkingBuffer 一并复位（不串味到下一章）
    expect(getGenSlot('w1')?.thinkingBuffer ?? '').toBe('');
  });

  it('正文内嵌 <think> 标签仍走分流兜底；流式+标签同时存在时拼接不丢内容', async () => {
    stubSwipeRoute(['data: {"thinking":"流式思考"}\n\n', 'data: {"text":"<think>标签思考</think>正文开始。"}\n\n']);
    await renderHook();
    const target = swipeTarget();
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.swipeRegenerate(baseWork(), [target], target);
    });
    // openai 通道下 <think> 内联标签由 runtime 分流器实时并入思考流（mergeThinking 只剩单源）
    expect(result!.extra.rawThinking).toBe('流式思考标签思考');
    expect(result!.content).toBe('正文开始。'); // 标签剥离干净
  });

  it('无 thinking 帧且正文无标签 → extra.rawThinking 不落空串（字段缺省）', async () => {
    stubSwipeRoute(['data: {"text":"纯净正文。"}\n\n']);
    await renderHook();
    const target = swipeTarget();
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.swipeRegenerate(baseWork(), [target], target);
    });
    expect(result!.extra.rawThinking).toBeUndefined();
  });
});
