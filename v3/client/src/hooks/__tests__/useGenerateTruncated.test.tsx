/**
 * useGenerate.continueFromPartial + 上下文截断提示测试（M2 Chunk 5 任务化迁移）
 *
 * continueFromPartial 切 server 任务 mode=continue（半成品基底 + buildContinueDirective
 * 在 server 编排）——组装期截断记录随组装上移 server，任务终态暂无截断字段（挂账回传），
 * lastTruncated 保持恒 false；本文件锁定 continue 提交契约 / 终态同步 / failed 槽 fail /
 * 提示条复位接口。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiVersion, type Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import { getGenSlot, useGenerationStore } from '../../stores/generation';
import { useSettingsStore } from '../../stores/settings';
import { useWorkStore } from '../../stores/work';

import { useGenerate, type UseGenerateResult } from '../useGenerate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonRes(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

const workFixture: Work = {
  id: 'w1',
  revision: 1,
  title: '测试',
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

// ---------- hook harness ----------
const roots: Root[] = [];
let latest: UseGenerateResult | null = null;

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
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  latest = null;
  document.body.innerHTML = '';
  useGenerationStore.setState({ slots: {} });
  useWorkStore.setState({ messages: [] });
});

describe('useGenerate.continueFromPartial（断流续写切 server 任务 mode=continue）', () => {
  it('提交契约 mode=continue + partial 基底；终态取回入库消息并同步本地；lastTruncated 保持 false（server 截断字段未回传，挂账）', async () => {
    pollScript = [
      { status: 'running', progressLen: 4, progressText: '接着写', done: 0, chapterTotal: 1, phase: 'continuing', chapterIndex: 1 },
      { status: 'done', resultMessages: 1, resultMessageIds: ['m9'] },
    ];
    storedMessages = [chapterMsg('m9', 1, '断流半成品基底接着写完的正文。')];
    stubTaskRoute();
    await renderHook();
    expect(latest!.lastTruncated).toBe(false);

    let msg: Message | null | undefined;
    act(() => {
      void latest!.continueFromPartial(workFixture, [], '断流半成品基底').then((r) => {
        msg = r;
      });
    });
    await drainPolls(2);
    // 提交契约：半成品原样透传（续写指令/续写轮要求块由 server 编排构造）
    const submit = calls.find((c) => c.path === '/api/llm/tasks')!;
    const body = JSON.parse(String(submit.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ kind: 'novel-chapter', workId: 'w1', mode: 'continue', partial: '断流半成品基底' });
    expect(msg).toEqual(expect.objectContaining({ id: 'm9' }));
    expect(useWorkStore.getState().messages.map((m) => m.id)).toEqual(['m9']);
    expect(getGenSlot('w1')?.error ?? null).toBeNull();

    // 任务化后客户端无组装链：lastTruncated 恒 false（server 任务终态暂无截断字段——挂账回传后接回）
    expect(latest!.lastTruncated).toBe(false);
    await act(async () => {
      latest!.clearTruncated();
    });
    expect(latest!.lastTruncated).toBe(false);
  });

  it('任务 failed → 返回 null + 槽 fail（含 server 原因）', async () => {
    pollScript = [{ status: 'failed', error: '第 1 章续写失败：上游超时', resultMessages: 0, resultMessageIds: [] }];
    stubTaskRoute();
    await renderHook();
    let msg: Message | null | undefined;
    act(() => {
      void latest!.continueFromPartial(workFixture, [], '断流半成品基底').then((r) => {
        msg = r;
      });
    });
    await drainPolls(2);
    expect(msg).toBeNull();
    expect(getGenSlot('w1')?.error).toMatchObject({ code: 'LLM_FAILED' });
    expect(getGenSlot('w1')?.error?.message).toContain('上游超时');
    expect(useWorkStore.getState().messages).toHaveLength(0);
  });
});
