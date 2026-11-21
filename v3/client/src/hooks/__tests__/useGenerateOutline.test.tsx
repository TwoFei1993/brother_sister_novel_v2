/**
 * useGenerate.runByOutline 按大纲生成集成测试（M2 Chunk 4 任务化迁移：mock 层改为任务响应
 * 序列——提交 outline=true + chapters=大纲剩余覆盖章数 → 轮询 → 终态同步）。逐章大纲要点
 * 注入断言随组装上移 server（server 端 orchestrate 测试覆盖）；客户端锁：提交契约
 * （outline/chapters/directive）/ 终态同步 / failed / 覆盖完与无大纲零请求。
 * outlineRunPlan·batchProgressText 纯函数测试保留。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiVersion, type Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import {
  batchProgressText,
  outlineRunPlan,
  OUTLINE_DIRECTIVE,
} from '../generation-flow';
import { buildChapterMessage } from '../generation-flow';
import { getGenSlot, useGenerationStore } from '../../stores/generation';
import { useSettingsStore } from '../../stores/settings';
import { useWorkStore } from '../../stores/work';

import { useGenerate } from '../useGenerate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonRes(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

const OUTLINES_1_3 = [
  { index: 1, title: '落地嫡长', plot: '胎穿嫡长女，隐藏空间。' },
  { index: 2, title: '私囤万千', plot: '幼年囤积。' },
  { index: 3, title: '幼学启蒙', plot: '起步碾压。' },
];

function workFixture(chapterOutlines: { index: number; title: string; plot: string }[] = OUTLINES_1_3): Work {
  return {
    id: 'w1',
    revision: 1,
    title: '按大纲测试',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings, chapterOutlines },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

// ---------- fetch stub（任务响应序列） ----------
type FetchCall = { path: string; init: RequestInit };
let calls: FetchCall[] = [];
let pollScript: Array<Record<string, unknown>> = [];
let pollIdx = 0;
let storedMessages: Message[] = [];

function stubTaskRoute(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init: init ?? {} });
      if (path === '/api/llm/tasks' && (init?.method ?? 'GET') === 'POST') {
        return jsonRes({ taskId: 't1' }, 202);
      }
      if (path.startsWith('/api/llm/tasks/t1?since=') || path === '/api/llm/tasks/t1') {
        const item = pollScript[Math.min(pollIdx, pollScript.length - 1)];
        pollIdx += 1;
        return jsonRes(item);
      }
      if (path.startsWith('/api/works/w1/messages?')) return jsonRes({ messages: storedMessages });
      throw new Error(`unmocked fetch: ${path}`);
    }),
  );
}

async function drainPolls(ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
  }
}

function chapterMsg(id: string, index: number): Message {
  const content = `第${index}章正文，足够长的一段话。`;
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

function seedChapter(index: number): Message {
  return buildChapterMessage({
    content: `第${index}章正文`,
    title: `第${index}章`,
    chapterIndex: index,
    directive: '旧指令',
    promptTokens: 1,
    generationMs: 1,
  });
}

// ---------- hook harness ----------
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
  vi.useFakeTimers();
  localStorage.clear();
  calls = [];
  pollScript = [];
  pollIdx = 0;
  storedMessages = [];
  useGenerationStore.setState({ slots: {} });
  useWorkStore.setState({ messages: [] });
  useSettingsStore.getState().setLlmPrefs({ source: 'openai', model: 'gpt-4o' });
  stubTaskRoute();
});

afterEach(async () => {
  vi.useRealTimers();
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

/** 驱动 runByOutline 至终态 */
async function runOutline(work: Work, messages: Message[], limit?: number, ticks = 2): Promise<void> {
  let promise: Promise<void> | null = null;
  act(() => {
    promise = latest!.runByOutline(work, messages, limit);
  });
  await drainPolls(ticks);
  await act(async () => {
    await promise;
  });
}

describe('useGenerate.runByOutline（📖按大纲生成——server 任务路径，M2 Chunk 4）', () => {
  it('大纲 1-3 章、无已有章节：提交 outline=true + chapters=3 任务，终态同步 3 章', async () => {
    pollScript = [
      { status: 'running', progressLen: 0, progressText: '', done: 2, chapterTotal: 3, phase: 'generating', chapterIndex: 3 },
      { status: 'done', resultMessages: 3, resultMessageIds: ['m1', 'm2', 'm3'] },
    ];
    storedMessages = [chapterMsg('m1', 1), chapterMsg('m2', 2), chapterMsg('m3', 3)];
    await renderHook();
    await runOutline(workFixture(), []);
    // 提交契约：outline=true 走 server 大纲链；directive 恒为「按本章大纲写」（本章要点 server 按章号注入）
    const submit = calls.find((c) => c.path === '/api/llm/tasks')!;
    const body = JSON.parse(String(submit.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      kind: 'novel-chapter',
      workId: 'w1',
      mode: 'chapter',
      directive: OUTLINE_DIRECTIVE,
      chapters: 3,
      outline: true,
    });
    expect(useWorkStore.getState().messages.filter((m) => m.chapter)).toHaveLength(3);
    expect(latest!.batch).toBeNull(); // 进度终态归位
    expect(getGenSlot('w1')?.error ?? null).toBeNull();
  });

  it('区别于目标章节数：大纲覆盖到 5 章 → 提交 chapters=5（写满大纲覆盖，不凑目标章数）', async () => {
    pollScript = [{ status: 'done', resultMessages: 5, resultMessageIds: [] }];
    await renderHook();
    await runOutline(
      workFixture([
        ...OUTLINES_1_3,
        { index: 4, title: '锋芒初露', plot: '家宴立威。' },
        { index: 5, title: '暗流涌动', plot: '族老发难。' },
      ]),
      [],
    );
    const body = JSON.parse(String((calls.find((c) => c.path === '/api/llm/tasks')!).init.body)) as { chapters: number };
    expect(body.chapters).toBe(5);
  });

  it('从「下一章」开始：已写 2 章 → 只提交剩余 1 章（chapters=1）', async () => {
    pollScript = [{ status: 'done', resultMessages: 1, resultMessageIds: ['m3'] }];
    storedMessages = [chapterMsg('m3', 3)];
    useWorkStore.setState({ messages: [seedChapter(1), seedChapter(2)] });
    await renderHook();
    await runOutline(workFixture(), useWorkStore.getState().messages);
    const body = JSON.parse(String((calls.find((c) => c.path === '/api/llm/tasks')!).init.body)) as { chapters: number };
    expect(body.chapters).toBe(1);
    expect(useWorkStore.getState().messages.filter((m) => m.chapter)).toHaveLength(3);
  });

  it('limit 截断：大纲剩 3 章但 limit=1 → 提交 chapters=1（「先写 N 章」）', async () => {
    pollScript = [{ status: 'done', resultMessages: 1, resultMessageIds: [] }];
    await renderHook();
    await runOutline(workFixture(), [], 1);
    const body = JSON.parse(String((calls.find((c) => c.path === '/api/llm/tasks')!).init.body)) as { chapters: number };
    expect(body.chapters).toBe(1);
  });

  it('任务 failed → error 进槽，已成功章保留', async () => {
    pollScript = [
      { status: 'running', progressLen: 4, progressText: '第一章', done: 1, chapterTotal: 3, phase: 'saving', chapterIndex: 2 },
      { status: 'failed', error: '第 2 章生成失败：上游超时', resultMessages: 1, resultMessageIds: ['m1'] },
    ];
    storedMessages = [chapterMsg('m1', 1)];
    await renderHook();
    await runOutline(workFixture(), []);
    expect(getGenSlot('w1')?.error).toMatchObject({ code: 'LLM_FAILED' });
    expect(useWorkStore.getState().messages.filter((m) => m.chapter)).toHaveLength(1);
    expect(latest!.batch).toBeNull();
  });

  it('大纲已覆盖完（下一章 4 > 最大章号 3）→ 零请求直接返回', async () => {
    useWorkStore.setState({ messages: [seedChapter(1), seedChapter(2), seedChapter(3)] });
    await renderHook();
    await act(async () => {
      await latest!.runByOutline(workFixture(), useWorkStore.getState().messages);
    });
    expect(calls).toHaveLength(0);
  });

  it('无大纲 → 零请求（按钮侧由 canOutline 保证，此处防御兜底）', async () => {
    await renderHook();
    await act(async () => {
      await latest!.runByOutline(workFixture([]), []);
    });
    expect(calls).toHaveLength(0);
  });

  it('指令常量：OUTLINE_DIRECTIVE = 按本章大纲写', () => {
    expect(OUTLINE_DIRECTIVE).toBe('按本章大纲写');
  });
});

describe('outlineRunPlan / batchProgressText 纯函数', () => {
  it('无大纲/空数组 → null；正常区间从下一章到大纲最大章号', () => {
    expect(outlineRunPlan([], undefined)).toBeNull();
    expect(outlineRunPlan([], [])).toBeNull();
    expect(outlineRunPlan([], OUTLINES_1_3)).toEqual({ start: 1, end: 3, total: 3 });
    expect(outlineRunPlan([seedChapter(1), seedChapter(2), seedChapter(3)], OUTLINES_1_3)).toBeNull(); // 覆盖完
  });

  it('断号衔接：已写到第 1 章且大纲只含第 3 章 → 下一章 2 写到大纲最大章号 3', () => {
    const only3: { index: number }[] = [{ index: 3 }];
    expect(outlineRunPlan([seedChapter(1)], only3)).toEqual({ start: 2, end: 3, total: 2 }); // 第 2 章无大纲匹配自由发挥，第 3 章按大纲
  });

  it('进度文案：连写 3/50、按大纲 2/7（前缀区分两种批量）', () => {
    expect(batchProgressText({ done: 3, total: 50 })).toBe('3/50');
    expect(batchProgressText({ done: 2, total: 7, mode: 'outline' })).toBe('按大纲 2/7');
  });
});
