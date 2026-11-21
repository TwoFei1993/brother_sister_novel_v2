/**
 * useGenerate.runBatch 一键连写集成测试（M2 Chunk 4 任务化迁移：mock 层从逐章 SSE 流改为
 * 任务响应序列——提交 chapters=剩余章数 → 轮询 done 计数驱动 setBatch → 终态按
 * resultMessageIds 批量同步本地视图）。逐章 directive/输出守卫等组装断言随组装上移 server
 * （server 端 orchestrate 测试覆盖）；客户端锁：提交契约 / 进度推进 / 终态同步 / stop / failed。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiVersion, type Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import { buildChapterMessage } from '../generation-flow';
import { getGenSlot, useGenerationStore } from '../../stores/generation';
import { useSettingsStore } from '../../stores/settings';
import { useWorkStore } from '../../stores/work';

import { useGenerate } from '../useGenerate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonRes(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function workFixture(desiredChapterCount: number): Work {
  return {
    id: 'w1',
    revision: 1,
    title: '连写测试',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings, desiredChapterCount },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
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
      if (path === '/api/llm/tasks/t1/cancel') return jsonRes({ ok: true });
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

describe('useGenerate.runBatch（一键连写——server 任务路径，M2 Chunk 4）', () => {
  it('desired=3 提交 chapters=3 任务（首章携指令）：轮询进度推进 setBatch，终态同步 3 章', async () => {
    pollScript = [
      { status: 'running', progressLen: 2, progressText: '一', done: 1, chapterTotal: 3, phase: 'saving', chapterIndex: 2 },
      { status: 'running', progressLen: 2, progressText: '', done: 2, chapterTotal: 3, phase: 'generating', chapterIndex: 3 },
      { status: 'done', resultMessages: 3, resultMessageIds: ['m1', 'm2', 'm3'] },
    ];
    storedMessages = [chapterMsg('m1', 1), chapterMsg('m2', 2), chapterMsg('m3', 3)];
    await renderHook();

    let promise: Promise<void> | null = null;
    act(() => {
      promise = latest!.runBatch(workFixture(3), '兄妹进入城堡');
    });
    await drainPolls(1);
    // 提交契约：单任务 chapters=3（逐章循环在 server 编排），directive=首章指令
    const submit = calls.find((c) => c.path === '/api/llm/tasks')!;
    const body = JSON.parse(String(submit.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ kind: 'novel-chapter', workId: 'w1', mode: 'chapter', directive: '兄妹进入城堡', chapters: 3 });
    expect(body.outline).toBeUndefined();
    // 轮询 done 计数驱动 setBatch（chunk 语义 done=已写到章号）
    expect(latest!.batch).toMatchObject({ done: 1, total: 3, mode: 'chunk' });
    await drainPolls(2);
    await act(async () => {
      await promise;
    });
    // 终态同步：3 章全部 upsertLocal；进度归位
    expect(useWorkStore.getState().messages.filter((m) => m.chapter)).toHaveLength(3);
    expect(latest!.batch).toBeNull();
    expect(getGenSlot('w1')?.error ?? null).toBeNull();
  });

  it('已达目标章数（下一章号 > 目标）→ 零请求直接返回', async () => {
    useWorkStore.setState({ messages: [seedChapter(1), seedChapter(2), seedChapter(3)] });
    await renderHook();
    await act(async () => {
      await latest!.runBatch(workFixture(3), '不会再写');
    });
    expect(calls).toHaveLength(0);
  });

  it('chapters 取剩余章数且不超 server 上限 50：desired=10 提交 10；desired=60 首批 clamp 50', async () => {
    await renderHook();

    let promise: Promise<void> | null = null;
    act(() => {
      promise = latest!.runBatch(workFixture(10), '首章指令');
    });
    await drainPolls(1);
    expect((JSON.parse(String((calls.find((c) => c.path === '/api/llm/tasks')!).init.body)) as { chapters: number }).chapters).toBe(10);
    await act(async () => {
      await promise;
    });

    calls = [];
    pollScript = [{ status: 'done', resultMessages: 1, resultMessageIds: [] }];
    let p2: Promise<void> | null = null;
    act(() => {
      p2 = latest!.runBatch(workFixture(60), '首章指令');
    });
    await drainPolls(1);
    expect((JSON.parse(String((calls.find((c) => c.path === '/api/llm/tasks')!).init.body)) as { chapters: number }).chapters).toBe(50);
    await act(async () => {
      await p2;
    });
    expect(getGenSlot('w1')?.error ?? null).toBeNull();
  });

  it('中途 stop()：POST cancel + 槽立即 fail(null, partialKept)，终局已完成章同步、batch 归 null', async () => {
    pollScript = [
      { status: 'running', progressLen: 2, progressText: '写到', done: 1, chapterTotal: 5, phase: 'saving', chapterIndex: 2 },
      { status: 'running', progressLen: 0, progressText: '', done: 1, chapterTotal: 5, phase: 'generating', chapterIndex: 2 },
      { status: 'done', resultMessages: 1, resultMessageIds: ['m1'] }, // 取消后 server 已入库保留（D6）
    ];
    storedMessages = [chapterMsg('m1', 1)];
    await renderHook();
    let promise: Promise<void> | null = null;
    act(() => {
      promise = latest!.runBatch(workFixture(5), '第一章指令');
    });
    await drainPolls(1);
    await act(async () => {
      latest!.stop();
    });
    expect(calls.some((c) => c.path === '/api/llm/tasks/t1/cancel')).toBe(true);
    const slot = getGenSlot('w1')!;
    expect(slot.error).toBeNull(); // 用户停止非错误
    expect(slot.streaming).toBe(false); // UI 立即可交互
    await drainPolls(2);
    await act(async () => {
      await promise;
    });
    expect(useWorkStore.getState().messages.filter((m) => m.chapter)).toHaveLength(1); // 已入库章保留
    expect(latest!.batch).toBeNull();
  });

  it('任务 failed → error 进槽（循环语义上移 server：失败原因即任务错误），已完成章保留', async () => {
    pollScript = [
      { status: 'running', progressLen: 4, progressText: '第一章正文', done: 1, chapterTotal: 5, phase: 'saving', chapterIndex: 2 },
      { status: 'failed', error: '第 2 章生成失败：上游超时', resultMessages: 1, resultMessageIds: ['m1'] },
    ];
    storedMessages = [chapterMsg('m1', 1)];
    await renderHook();

    let promise: Promise<void> | null = null;
    act(() => {
      promise = latest!.runBatch(workFixture(5), '第一章指令');
    });
    await drainPolls(2);
    await act(async () => {
      await promise;
    });
    expect(getGenSlot('w1')?.error).toMatchObject({ code: 'LLM_FAILED' });
    expect(getGenSlot('w1')?.error?.message).toContain('上游超时');
    expect(useWorkStore.getState().messages.filter((m) => m.chapter)).toHaveLength(1); // 第 1 章保留
    expect(latest!.batch).toBeNull();
  });
});
