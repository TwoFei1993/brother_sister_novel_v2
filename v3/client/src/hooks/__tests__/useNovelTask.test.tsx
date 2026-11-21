/**
 * useNovelTask 集成测试（M2 Chunk 4：书页章节生成切换 server 后台任务的回流编排层）
 *
 * fetch 模块级 stub：提交（POST /api/llm/tasks）→ 增量轮询（GET ?since=N 任务响应序列）
 * → 终态取回（GET /api/works/:id/messages?tail）→ 取消（POST /:id/cancel）。
 * 覆盖：409 GEN_BUSY 槽 fail / 增量回流 appendChunk 序列与 since 推进 / done 后按
 * resultMessageIds upsertLocal / failed 槽 fail 且已完成章同步 / stop 调 cancel 且终局 stopped。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiVersion, type Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import { getGenSlot, useGenerationStore } from '../../stores/generation';
import { useSettingsStore } from '../../stores/settings';
import { useWorkStore } from '../../stores/work';

import { useNovelTask } from '../useNovelTask';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonRes(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function workFixture(): Work {
  return {
    id: 'w1',
    revision: 1,
    title: '任务回流测试',
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

// ---------- fetch stub ----------
type FetchCall = { path: string; init: RequestInit };
let calls: FetchCall[] = [];
/** 提交响应：202 {taskId} 或 409 GEN_BUSY */
let submitStatus = 202;
/** 轮询响应序列（依次返回；耗尽后重复最后一项——running 会一直重复） */
let pollScript: Array<Record<string, unknown>> = [];
/** 终态取回的入库消息（GET messages?tail 响应） */
let storedMessages: Message[] = [];

function stubTaskRoute(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const full: FetchCall = { path, init: init ?? {} };
      calls.push(full);
      if (path === '/api/llm/tasks' && (init?.method ?? 'GET') === 'POST') {
        if (submitStatus === 409) return jsonRes({ code: 'GEN_BUSY', message: '该书已有生成任务进行中' }, 409);
        return jsonRes({ taskId: 't1' }, 202);
      }
      if (path.startsWith('/api/llm/tasks/t1?since=') || path === '/api/llm/tasks/t1') {
        const item = pollScript[Math.min(pollIdx, pollScript.length - 1)];
        pollIdx += 1;
        return jsonRes(item);
      }
      if (path === '/api/llm/tasks/t1/cancel') return jsonRes({ ok: true });
      if (path.startsWith('/api/works/w1/messages?')) return jsonRes({ messages: storedMessages });
      throw new Error(`unmocked fetch: ${path}`);
    }),
  );
}

let pollIdx = 0;

// ---------- hook harness ----------
const roots: Root[] = [];
let latest: ReturnType<typeof useNovelTask> | null = null;

function Probe(): null {
  latest = useNovelTask('w1');
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
  pollIdx = 0;
  submitStatus = 202;
  pollScript = [];
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

describe('useNovelTask（提交 + 增量轮询 + 回流 + 终态同步）', () => {
  it('409 GEN_BUSY：槽 fail「该书已有生成任务进行中」，无轮询请求', async () => {
    submitStatus = 409;
    await renderHook();
    let outcome: Awaited<ReturnType<NonNullable<typeof latest>['submitAndWait']>> | null = null;
    await act(async () => {
      outcome = await latest!.submitAndWait({ work: workFixture(), mode: 'chapter', directive: '写第一章' });
    });
    expect(outcome!.failed).toBe(true);
    expect(outcome!.messages).toHaveLength(0);
    const slot = getGenSlot('w1')!;
    expect(slot.error).toEqual({ code: 'GEN_BUSY', message: '该书已有生成任务进行中' });
    expect(slot.streaming).toBe(false);
    expect(calls.filter((c) => c.path.startsWith('/api/llm/tasks/t1'))).toHaveLength(0);
    expect(localStorage.getItem('novel-gen-w1')).toBeNull(); // 提交失败清恢复锚点
  });

  it('增量回流：progressText 依次 appendChunk（打字机序列正确），since 逐拍推进', async () => {
    pollScript = [
      { status: 'running', progressLen: 3, progressText: '第一段', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 1 },
      { status: 'running', progressLen: 6, progressText: '续写', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 1 },
      { status: 'done', resultMessages: 1, resultMessageIds: ['m1'] },
    ];
    storedMessages = [chapterMsg('m1', 1, '第一段续写。')];
    await renderHook();
    let outcome: Awaited<ReturnType<NonNullable<typeof latest>['submitAndWait']>> | null = null;
    act(() => {
      void latest!.submitAndWait({ work: workFixture(), mode: 'chapter', directive: '写第一章' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(getGenSlot('w1')?.buffer).toBe('第一段');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(getGenSlot('w1')?.buffer).toBe('第一段续写');
    const sinces = calls
      .filter((c) => c.path.startsWith('/api/llm/tasks/t1?since='))
      .map((c) => Number(c.path.split('since=')[1]));
    expect(sinces).toEqual([0, 3]); // since 推进 = 已回流长度
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(getGenSlot('w1')?.streaming).toBe(false);
    void outcome;
  });

  it('done：按 resultMessageIds 取入库消息 upsertLocal 并返回（按 ids 序），槽收束', async () => {
    pollScript = [
      { status: 'running', progressLen: 2, progressText: '正', done: 0, chapterTotal: 2, phase: 'generating', chapterIndex: 1 },
      { status: 'done', resultMessages: 2, resultMessageIds: ['m1', 'm2'] },
    ];
    // 故意乱序存放：断言按 resultMessageIds 序返回
    storedMessages = [chapterMsg('m2', 2, '第二章'), chapterMsg('m1', 1, '第一章')];
    await renderHook();
    let outcome: Awaited<ReturnType<NonNullable<typeof latest>['submitAndWait']>> | null = null;
    act(() => {
      void latest!
        .submitAndWait({ work: workFixture(), mode: 'chapter', directive: '', chapters: 2 })
        .then((o) => {
          outcome = o;
        });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(outcome).not.toBeNull();
    expect(outcome!.stopped).toBe(false);
    expect(outcome!.failed).toBe(false);
    expect(outcome!.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(useWorkStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2']); // 本地视图已同步
    expect(getGenSlot('w1')?.buffer ?? '').toBe(''); // 正常完成收束：buffer 清除
    expect(localStorage.getItem('novel-gen-w1')).toBeNull(); // 终态清恢复锚点
  });

  it('failed：槽 fail 含 server 原因，已完成章仍同步（D6 已入库保留）', async () => {
    pollScript = [
      { status: 'running', progressLen: 4, progressText: '第一章正文', done: 1, chapterTotal: 3, phase: 'saving', chapterIndex: 2 },
      { status: 'failed', error: '第 2 章生成失败：上游超时', resultMessages: 1, resultMessageIds: ['m1'] },
    ];
    storedMessages = [chapterMsg('m1', 1, '第一章正文')];
    await renderHook();
    let outcome: Awaited<ReturnType<NonNullable<typeof latest>['submitAndWait']>> | null = null;
    act(() => {
      void latest!
        .submitAndWait({ work: workFixture(), mode: 'chapter', directive: '', chapters: 3 })
        .then((o) => {
          outcome = o;
        });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(outcome!.failed).toBe(true);
    expect(getGenSlot('w1')?.error).toMatchObject({ code: 'LLM_FAILED' });
    expect(getGenSlot('w1')?.error?.message).toContain('上游超时');
    expect(useWorkStore.getState().messages.map((m) => m.id)).toEqual(['m1']); // 已完成章保留
  });

  it('stop：POST cancel + 槽立即 fail(null, partialKept)，终局 stopped 且已完成章同步', async () => {
    pollScript = [
      { status: 'running', progressLen: 3, progressText: '写到', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 1 },
      { status: 'running', progressLen: 3, progressText: '', done: 0, chapterTotal: 1, phase: 'generating', chapterIndex: 1 },
      { status: 'done', resultMessages: 0, resultMessageIds: [] },
    ];
    await renderHook();
    let outcome: Awaited<ReturnType<NonNullable<typeof latest>['submitAndWait']>> | null = null;
    act(() => {
      void latest!.submitAndWait({ work: workFixture(), mode: 'chapter', directive: '写第一章' }).then((o) => {
        outcome = o;
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500); // 第一拍：回流「写到」
    });
    expect(getGenSlot('w1')?.buffer).toBe('写到');
    await act(async () => {
      latest!.stop();
    });
    expect(calls.some((c) => c.path === '/api/llm/tasks/t1/cancel')).toBe(true);
    const slot = getGenSlot('w1')!;
    expect(slot.error).toBeNull(); // 用户停止非错误
    expect(slot.partialKept).toBe(true);
    expect(slot.streaming).toBe(false); // UI 立即可交互
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500); // 第二拍（停止后不再回流）
    });
    expect(getGenSlot('w1')?.buffer).toBe('写到'); // 停止后 buffer 冻结
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500); // 终态拍
    });
    expect(outcome!.stopped).toBe(true);
    expect(localStorage.getItem('novel-gen-w1')).toBeNull();
  });
});

describe('跨章增量与恢复重收（缝②：buffer 只承载当前章）', () => {
  it('翻章检测：progressLen 回落（server 换章 text 清零）→ buffer 重置为新章、since 归零重收全文', async () => {
    pollScript = [
      { status: 'running', progressLen: 3, progressText: '第一章', done: 0, chapterTotal: 2, phase: 'generating', chapterIndex: 1 },
      // 翻章拍：text 清零 progressLen=0 < since=3；progressText 按旧 since 切片越界为空
      { status: 'running', progressLen: 0, progressText: '', done: 1, chapterTotal: 2, phase: 'assembling', chapterIndex: 2 },
      { status: 'running', progressLen: 5, progressText: '第二章开头', done: 1, chapterTotal: 2, phase: 'generating', chapterIndex: 2 },
      { status: 'done', resultMessages: 2, resultMessageIds: ['m1', 'm2'] },
    ];
    storedMessages = [chapterMsg('m1', 1, '第一章'), chapterMsg('m2', 2, '第二章开头')];
    await renderHook();
    act(() => {
      void latest!.submitAndWait({ work: workFixture(), mode: 'chapter', directive: '', chapters: 2 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500); // 拍1：since=0 → buffer=「第一章」，since=3
    });
    expect(getGenSlot('w1')?.buffer).toBe('第一章');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500); // 拍2：翻章 → buffer 重置为空、since 归零
    });
    expect(getGenSlot('w1')?.buffer).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500); // 拍3：?since=0 重收第 2 章全文
    });
    expect(getGenSlot('w1')?.buffer).toBe('第二章开头'); // 第 1 章文本不残留
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500); // 终态拍
    });
    const sinces = calls
      .filter((c) => c.path.startsWith('/api/llm/tasks/t1?since='))
      .map((c) => Number(c.path.split('since=')[1]));
    expect(sinces).toEqual([0, 3, 0, 5]); // 翻章归零后从 0 重收（不再单调不减）
  });

  it('mount 恢复：since=0 重收当前章全文并重置 buffer（不接旧 buffer 长度续流），taskId/targetMessageId 保留', async () => {
    // 上一会话切页前：槽已有 buffer（旧语义下会以 buffer.length 作 since——错位源头）+ 恢复锚点
    localStorage.setItem('novel-gen-w1', 't1');
    useGenerationStore.getState().start('w1', 't-msg-1', '旧会话已收的部分文本');
    pollScript = [
      { status: 'running', progressLen: 5, progressText: '第二章全文', done: 1, chapterTotal: 2, phase: 'generating', chapterIndex: 2 },
      { status: 'done', resultMessages: 2, resultMessageIds: ['m1', 'm2'] },
    ];
    storedMessages = [chapterMsg('m1', 1, '第一章'), chapterMsg('m2', 2, '第二章全文')];
    await renderHook();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500); // 恢复第一拍：?since=0（而非旧 buffer 长度 9）
    });
    const slot = getGenSlot('w1')!;
    expect(slot.buffer).toBe('第二章全文'); // 旧 buffer 残留被重置，只含当前章全文
    expect(slot.streaming).toBe(true); // 仍在流式（任务未终态）
    expect(slot.targetMessageId).toBe('t-msg-1'); // 入库幂等键保留
    expect(slot.taskId).toBe('t1'); // 恢复锚点回填槽
    const sinces = calls
      .filter((c) => c.path.startsWith('/api/llm/tasks/t1?since='))
      .map((c) => Number(c.path.split('since=')[1]));
    expect(sinces[0]).toBe(0); // 恢复重收，不接旧 buffer 长度
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500); // 终态拍
    });
    expect(useWorkStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2']); // 已入库章同步
  });
});
