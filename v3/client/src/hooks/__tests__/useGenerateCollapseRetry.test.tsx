/**
 * useGenerate 崩溃重试测试（M2 Chunk 4 任务化迁移：mock 层从 SSE 流改为任务响应序列）。
 *
 * 原客户端「崩溃 → 反重复后缀重试 / 截断自动续写 / truncatedSwipeId 最后防线」编排已整体
 * 上移 server orchestrate（判据与阈值本体见 engine/prompt/novel/collapse-detect 单测 +
 * server 端 novel-gen 测试）。客户端锁定任务路径透传契约：
 * - server 持久化消息原样返回（content/directive/extra.truncatedSwipeId 不被本地改写）
 * - 增量回流打字机序列（progressText → buffer）
 * - failed → null + 槽 fail；stop → cancel + partialKept（半成品供「继续」）
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiVersion, type Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import { getGenSlot, useGenerationStore } from '../../stores/generation';
import { useSettingsStore } from '../../stores/settings';
import { useWorkStore } from '../../stores/work';

import { useGenerate } from '../useGenerate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonRes(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function workFixture(): Work {
  return {
    id: 'w1',
    revision: 1,
    title: '崩溃重试测试',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

const DIRECTIVE = '兄妹进入城堡';

/** server 持久化消息（含 truncatedSwipeId 版本级标记——server「最后防线」产物，客户端透传） */
function persistedChapter(id: string, content: string, opts: { truncated?: boolean } = {}): Message {
  return {
    id,
    role: 'assistant',
    name: '小说家',
    content,
    createdAt: 1,
    swipes: [aiVersion(content, 'v1', 1)],
    swipeId: 0,
    extra: opts.truncated ? { truncatedSwipeId: 0 } : {},
    chapter: { index: 1, title: '第1章' },
    directive: DIRECTIVE, // server 入库 directive 元数据保持干净原指令（重试后缀只进提示词）
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

describe('useGenerate.generateChapter 任务路径透传（崩溃重试/截断续写已上移 server）', () => {
  it('server 持久化消息原样返回：content/directive/truncatedSwipeId 不被本地改写，客户端零本地组装调用', async () => {
    pollScript = [
      { status: 'running', progressLen: 4, progressText: '第一章', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 1 },
      { status: 'done', resultMessages: 1, resultMessageIds: ['m1'] },
    ];
    storedMessages = [persistedChapter('m1', '第一章正文，足够长。', { truncated: true })];
    await renderHook();
    let msg: Message | null | undefined;
    act(() => {
      void latest!.generateChapter(workFixture(), [], DIRECTIVE).then((r) => {
        msg = r;
      });
    });
    await drainPolls(2);
    // 增量回流：progressText → buffer 打字机序列（视图复用）；终态收束后清空
    expect(msg).not.toBeNull();
    expect(msg!.content).toBe('第一章正文，足够长。');
    expect(msg!.directive).toBe(DIRECTIVE); // 元数据干净（重试后缀只在 server 提示词层）
    expect(msg!.extra.truncatedSwipeId).toBe(0); // server 截断标记透传，UI 据此显「未写完」
    // 任务化后客户端不再发 SSE 流/本地组装：唯一写请求是任务提交
    expect(calls.filter((c) => c.path === '/api/llm/generate')).toHaveLength(0);
    expect(useWorkStore.getState().messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('增量回流打字机序列正确（progressText 逐拍 appendChunk，since 推进不重不漏）', async () => {
    pollScript = [
      { status: 'running', progressLen: 5, progressText: '正文。', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 1 },
      { status: 'running', progressLen: 9, progressText: '加上结尾', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 1 },
      { status: 'done', resultMessages: 1, resultMessageIds: ['m1'] },
    ];
    storedMessages = [persistedChapter('m1', '正文。加上结尾')];
    await renderHook();
    let msg: Message | null | undefined;
    act(() => {
      void latest!.generateChapter(workFixture(), [], DIRECTIVE).then((r) => {
        msg = r;
      });
    });
    await drainPolls(1);
    expect(getGenSlot('w1')?.buffer).toBe('正文。');
    await drainPolls(1);
    expect(getGenSlot('w1')?.buffer).toBe('正文。加上结尾');
    const sinces = calls
      .filter((c) => c.path.startsWith('/api/llm/tasks/t1?since='))
      .map((c) => Number(c.path.split('since=')[1]));
    expect(sinces).toEqual([0, 5]); // since 严格按已回流长度推进——切片不重不漏
    await drainPolls(1);
    expect(msg).not.toBeNull();
    expect(msg!.content).toBe('正文。加上结尾');
  });

  it('任务 failed（server 编排判死）→ 返回 null + 槽 fail 含失败原因，已入库章保留', async () => {
    pollScript = [
      { status: 'running', progressLen: 4, progressText: '写到', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 1 },
      { status: 'failed', error: '第 1 章生成失败：重复循环', resultMessages: 0, resultMessageIds: [] },
    ];
    await renderHook();
    let msg: Message | null | undefined;
    act(() => {
      void latest!.generateChapter(workFixture(), [], DIRECTIVE).then((r) => {
        msg = r;
      });
    });
    await drainPolls(2);
    expect(msg).toBeNull(); // 不上架
    expect(getGenSlot('w1')?.error).toMatchObject({ code: 'LLM_FAILED' });
    expect(getGenSlot('w1')?.error?.message).toContain('重复循环');
  });

  it('stop → POST cancel + 槽 fail(null, partialKept=true)：半成品保留供「继续」', async () => {
    pollScript = [
      { status: 'running', progressLen: 4, progressText: '写到一半', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 1 },
      { status: 'done', resultMessages: 0, resultMessageIds: [] }, // 取消：当前段跑完即停，未入库（D6）
    ];
    await renderHook();
    let msg: Message | null | undefined;
    act(() => {
      void latest!.generateChapter(workFixture(), [], DIRECTIVE).then((r) => {
        msg = r;
      });
    });
    await drainPolls(1);
    await act(async () => {
      latest!.stop();
    });
    expect(calls.some((c) => c.path === '/api/llm/tasks/t1/cancel')).toBe(true);
    const slot = getGenSlot('w1')!;
    expect(slot.error).toBeNull(); // 用户停止非错误
    expect(slot.partialKept).toBe(true);
    expect(slot.buffer).toBe('写到一半'); // 半成品保留在界面
    await drainPolls(1);
    expect(msg).toBeNull(); // 未入库：无消息返回
    expect(useWorkStore.getState().messages).toHaveLength(0);
  });
});
