/**
 * useGenerate 集成测试（jsdom + createRoot harness）
 *
 * M2 Chunk 4/5 任务化迁移：generateChapter 与 swipeRegenerate 全部走 server novel-chapter
 * 任务——mock 层从 SSE 流改为任务响应序列（POST 202 → GET ?since 增量 → done+resultMessageIds）。
 * 分段/无效输出重试/截断续写/崩溃补救/historyBeforeTarget 上下文/appendSwipe 候选追加等
 * 语义已上移 server 编排（server 端 novel-gen 测试覆盖），客户端锁：提交参数契约 /
 * 增量回流 / 终态同步 / 409 与 failed 槽 fail / MAX_SWIPES 客户端预检。
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

/** 任务路径 stub：提交 + 增量轮询 + messages 拉取（全任务化后的统一 mock 形态） */
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
    localStorage.clear();
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

describe('useGenerate.swipeRegenerate（M2 Chunk 5：重 roll 切 server 任务 mode=swipe）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('swipes 满 50 → 客户端预检拒绝并提示 SWIPE_LIMIT，不发起任何请求（server 上限双层）', async () => {
    stubTaskRoute(); // 任何请求都算 unmocked 失败——断言根本不该发
    await renderHook();
    const target = buildChapterMessage({ content: 'v1', title: '一', chapterIndex: 1, promptTokens: 1, generationMs: 1 });
    target.swipes = Array.from({ length: 50 }, (_, i) => aiVersion(`第${i + 1}支`, `v${i + 1}`, i));
    let result: Message | null = null;
    await act(async () => {
      result = await latest!.swipeRegenerate(baseWork(), [target], target);
    });
    expect(result).toBeNull();
    expect(getGenSlot('w1')?.error).toMatchObject({ code: 'SWIPE_LIMIT' });
    expect(getGenSlot('w1')?.error?.message).toContain('50');
    expect(getGenSlot('w1')?.partialKept).toBe(false);
    expect(calls).toHaveLength(0); // 未发任何请求
  });

  it('提交契约 mode=swipe + targetId + directive 取 target.directive；终态取回 server appendSwipe 后的目标消息并同步本地', async () => {
    const prev = userMsg('u1', '前面的剧情');
    const target = buildChapterMessage({
      content: '旧候选正文XYZ',
      title: '二',
      chapterIndex: 2,
      directive: '写第二章',
      promptTokens: 1,
      generationMs: 1,
    });
    pollScript = [
      { status: 'running', progressLen: 3, progressText: '新候选', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 2 },
      { status: 'done', resultMessages: 1, resultMessageIds: [target.id] },
    ];
    // server appendSwipe 产物：新候选追加进 target.swipes（上下文取 target 之前等组装语义在 server orchestrate）
    storedMessages = [{ ...target, content: '新候选。', swipes: [...target.swipes, aiVersion('新候选。', 'v2', 1)], swipeId: 1 }];
    stubTaskRoute();
    await renderHook();
    let result: Message | null | undefined;
    act(() => {
      void latest!.swipeRegenerate(baseWork(), [prev, target], target).then((r) => {
        result = r;
      });
    });
    await drainPolls(2);
    const submit = calls.find((c) => c.path === '/api/llm/tasks')!;
    const body = JSON.parse(String(submit.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ kind: 'novel-chapter', workId: 'w1', mode: 'swipe', targetId: target.id, directive: '写第二章' });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(target.id);
    expect(result!.swipes.map((v) => v.content)).toEqual(['旧候选正文XYZ', '新候选。']); // server 候选追加原样同步
    expect(result!.swipeId).toBe(1);
    expect(useWorkStore.getState().messages.map((m) => m.id)).toEqual([target.id]); // 本地视图已同步
    expect(calls.some((c) => c.path === '/api/llm/generate')).toBe(false); // 客户端不再走 SSE 流
  });

  it('任务 failed → 返回 null + 槽 fail（原候选不动）', async () => {
    const target = buildChapterMessage({ content: 'v1', title: '一', chapterIndex: 1, directive: '写第一章', promptTokens: 1, generationMs: 1 });
    pollScript = [{ status: 'failed', error: '上游无有效输出', resultMessages: 0, resultMessageIds: [] }];
    stubTaskRoute();
    await renderHook();
    let result: Message | null | undefined;
    act(() => {
      void latest!.swipeRegenerate(baseWork(), [target], target).then((r) => {
        result = r;
      });
    });
    await drainPolls(2);
    expect(result).toBeNull();
    expect(getGenSlot('w1')?.error).toMatchObject({ code: 'LLM_FAILED' });
    expect(useWorkStore.getState().messages).toHaveLength(0);
  });
});

describe('useGenerate.swipeRegenerate（连续两次重roll 回归——任务路径候选累加不丢失）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 驱动一次 swipe 任务至终态 */
  async function swipeOnce(work: Work, all: Message[], target: Message): Promise<Message | null> {
    let r: Message | null = null;
    act(() => {
      void latest!.swipeRegenerate(work, all, target).then((x) => {
        r = x;
      });
    });
    await drainPolls(2);
    return r ?? null;
  }

  it('连续两次重roll：server 累加候选原样同步（v1→[v1,A]→[v1,A,B]，swipeId 指向最新）', async () => {
    stubTaskRoute();
    await renderHook();
    const prev = userMsg('u1', '前面的剧情');
    const target = buildChapterMessage({ content: 'v1', title: '一', chapterIndex: 1, directive: '写第一章', promptTokens: 1, generationMs: 1 });
    // 第一次：server 在 [v1] 上追加候选 A
    pollScript = [{ status: 'done', resultMessages: 1, resultMessageIds: [target.id] }];
    storedMessages = [{ ...target, content: '重roll候选1。', swipes: [...target.swipes, aiVersion('重roll候选1。', 'v2', 1)], swipeId: 1 }];
    let r = await swipeOnce(baseWork(), [prev, target], target);
    expect(r!.swipes.map((v) => v.content)).toEqual(['v1', '重roll候选1。']);
    const first = r!;
    // 第二次重roll：server 在 [v1, A] 上追加 B（自动命名 v3），终态同步回 3 支候选
    pollScript = [{ status: 'done', resultMessages: 1, resultMessageIds: [first.id] }];
    storedMessages = [{ ...first, content: '重roll候选2。', swipes: [...first.swipes, aiVersion('重roll候选2。', 'v3', 2)], swipeId: 2 }];
    r = await swipeOnce(baseWork(), [prev, first], first);
    expect(r!.swipes.map((v) => v.content)).toEqual(['v1', '重roll候选1。', '重roll候选2。']);
    expect(r!.swipeId).toBe(2);
    expect(r!.content).toBe('重roll候选2。');
    expect(calls.filter((c) => c.path === '/api/llm/tasks' && (c.init.method ?? 'GET') === 'POST')).toHaveLength(2); // 每次各一个任务
  });
});

describe('useGenerate.swipeRegenerate（💭思考链任务路径透传——server 产物原样同步）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** swipe 目标（重 roll 走 server appendSwipe 通道，thinking 提取在 server 端同源） */
  function swipeTarget(): Message {
    return buildChapterMessage({ content: 'v1', title: '一', chapterIndex: 1, directive: '写第一章', promptTokens: 1, generationMs: 1 });
  }

  it('server 入库的 extra.rawThinking 原样返回（💭折叠真实数据源），槽 thinkingBuffer 收束复位不串味', async () => {
    const target = swipeTarget();
    pollScript = [{ status: 'done', resultMessages: 1, resultMessageIds: [target.id] }];
    storedMessages = [
      {
        ...target,
        content: '雨夜里妹妹攥紧了哥哥的袖口。',
        swipes: [...target.swipes, aiVersion('雨夜里妹妹攥紧了哥哥的袖口。', 'v2', 1)],
        swipeId: 1,
        extra: { rawThinking: '先想兄妹动机：是复仇还是逃离。选逃离，留悬念。' },
      },
    ];
    stubTaskRoute();
    await renderHook();
    let result: Message | null | undefined;
    act(() => {
      void latest!.swipeRegenerate(baseWork(), [target], target).then((r) => {
        result = r;
      });
    });
    await drainPolls(2);
    expect(result).not.toBeNull();
    // 流式思考入库产物（MiniMax M3 不写 <think> 标签，这是💭折叠的唯一真实数据源）
    expect(result!.extra.rawThinking).toBe('先想兄妹动机：是复仇还是逃离。选逃离，留悬念。');
    expect(result!.content).toContain('妹妹攥紧了哥哥的袖口。');
    expect(getGenSlot('w1')?.thinkingBuffer ?? '').toBe(''); // 槽收束后复位，不串味到下一章
  });

  it('server 已剥离 <think> 标签的正文原样同步（client 不做二次分流/拼接）', async () => {
    const target = swipeTarget();
    pollScript = [{ status: 'done', resultMessages: 1, resultMessageIds: [target.id] }];
    storedMessages = [
      {
        ...target,
        content: '正文开始。',
        swipes: [...target.swipes, aiVersion('正文开始。', 'v2', 1)],
        swipeId: 1,
        extra: { rawThinking: '流式思考标签思考' },
      },
    ];
    stubTaskRoute();
    await renderHook();
    let result: Message | null | undefined;
    act(() => {
      void latest!.swipeRegenerate(baseWork(), [target], target).then((r) => {
        result = r;
      });
    });
    await drainPolls(2);
    expect(result!.content).toBe('正文开始。'); // 标签已由 server 剥离干净
    expect(result!.extra.rawThinking).toBe('流式思考标签思考');
  });

  it('无思考产物 → extra.rawThinking 字段缺省透传（不落空串）', async () => {
    const target = swipeTarget();
    pollScript = [{ status: 'done', resultMessages: 1, resultMessageIds: [target.id] }];
    storedMessages = [{ ...target, content: '纯净正文。', swipes: [...target.swipes, aiVersion('纯净正文。', 'v2', 1)], swipeId: 1 }];
    stubTaskRoute();
    await renderHook();
    let result: Message | null | undefined;
    act(() => {
      void latest!.swipeRegenerate(baseWork(), [target], target).then((r) => {
        result = r;
      });
    });
    await drainPolls(2);
    expect(result!.content).toBe('纯净正文。');
    expect(result!.extra.rawThinking).toBeUndefined();
  });
});
