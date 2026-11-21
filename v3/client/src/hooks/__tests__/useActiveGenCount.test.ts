/**
 * useActiveGenCount 测试（Chunk 6 Task 6.2）：顶栏「后台生成中 N 本」计数轮询。
 * fetch stub 脚本化 /active 响应；fake timers 驱动 5s 节拍。
 */
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTIVE_GEN_POLL_MS, useActiveGenCount } from '../useActiveGenCount';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ActiveItem = Record<string, unknown>;
function novelTask(workId: string): ActiveItem {
  return { id: `task-${workId}`, kind: 'novel-chapter', workId, progressLen: 0, done: 1, chapterTotal: 2, createdAt: 1 };
}
function llmTask(): ActiveItem {
  return { id: 'task-llm', kind: 'llm', label: '大纲', progressLen: 0, done: 0, chapterTotal: 0, createdAt: 1 };
}

/** /active 响应脚本（依次出队；耗尽后重复最后一项；null = 500 抖动拍） */
let script: (ActiveItem[] | null)[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path !== '/api/llm/tasks/active') throw new Error(`unmocked fetch: ${path}`);
      if (script.length === 0) return new Response(JSON.stringify({ tasks: [] }), { status: 200 });
      const item = script[0];
      if (script.length > 1) script = script.slice(1);
      if (item === null) return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      return new Response(JSON.stringify({ tasks: item }), { status: 200 });
    }),
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const roots: Root[] = [];
let latest: number | null = null;

function Probe(): null {
  latest = useActiveGenCount();
  return null;
}

async function renderHook(): Promise<void> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(Probe));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  script = [];
  latest = null;
  stubFetch();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useActiveGenCount', () => {
  it(`active 返回 N 本 novel-chapter → 计数 N（llm 任务不计入）；每 ${ACTIVE_GEN_POLL_MS}ms 一拍`, async () => {
    script = [[novelTask('w1'), novelTask('w2'), llmTask()]];
    await renderHook();
    await flush();
    expect(latest).toBe(2);
    // 第二拍：一本完成 → 计数 1
    script = [[novelTask('w1')]];
    await act(async () => {
      vi.advanceTimersByTime(ACTIVE_GEN_POLL_MS);
      await Promise.resolve();
    });
    await flush();
    expect(latest).toBe(1);
  });

  it('active 无 novel-chapter 任务 → 计数 0', async () => {
    script = [[llmTask()]];
    await renderHook();
    await flush();
    expect(latest).toBe(0);
  });

  it('单次轮询抖动（500）静默：保留上次计数，下一拍恢复', async () => {
    script = [[novelTask('w1')], null, [novelTask('w1'), novelTask('w2')]];
    await renderHook();
    await flush();
    expect(latest).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(ACTIVE_GEN_POLL_MS);
      await Promise.resolve();
    });
    await flush();
    expect(latest).toBe(1); // 抖动拍保留
    await act(async () => {
      vi.advanceTimersByTime(ACTIVE_GEN_POLL_MS);
      await Promise.resolve();
    });
    await flush();
    expect(latest).toBe(2);
  });

  it('卸载后停止轮询', async () => {
    await renderHook();
    await flush();
    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const root = roots.pop()!;
    await act(async () => {
      root.unmount();
    });
    await act(async () => {
      vi.advanceTimersByTime(ACTIVE_GEN_POLL_MS * 3);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
