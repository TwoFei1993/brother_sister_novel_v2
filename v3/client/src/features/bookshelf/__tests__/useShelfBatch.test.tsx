/**
 * useShelfBatch 测试（Chunk 6 Task 6.1）：多选状态机 + active 5s 轮询 + 终态感知刷新。
 * fetchActiveTasks 模块级 mock（保留 novelTasksByWork 真实现）；fake timers 驱动轮询节拍。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchActiveTasks, type ActiveTask } from '../../../lib/activeTasks';
import { SHELF_POLL_MS, useShelfBatch, type ShelfBatch } from '../useShelfBatch';

vi.mock('../../../lib/activeTasks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchActiveTasks: vi.fn(),
}));

const fetchActiveTasksMock = vi.mocked(fetchActiveTasks);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function task(workId: string, partial: Partial<ActiveTask> = {}): ActiveTask {
  return {
    id: `task-${workId}`,
    kind: 'novel-chapter',
    workId,
    progressLen: 500,
    done: 1,
    chapterTotal: 3,
    phase: 'generating',
    createdAt: 1,
    ...partial,
  };
}

/** 拉平 mock promise 的微任务（轮询 tick 内 await 后的 setState 需要） */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------- hook harness ----------
const roots: Root[] = [];
let latest: ShelfBatch | null = null;

function Probe({ refresh }: { refresh: () => void }): null {
  latest = useShelfBatch(refresh);
  return null;
}

async function renderHook(refresh: () => void = () => undefined): Promise<void> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<Probe refresh={refresh} />);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchActiveTasksMock.mockReset();
  fetchActiveTasksMock.mockResolvedValue([]);
  latest = null;
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useShelfBatch 轮询', () => {
  it('挂载立即拉取一次 active：novel-chapter 按 workId 索引（llm 任务不入）', async () => {
    fetchActiveTasksMock.mockResolvedValue([
      task('w1', { done: 2, chapterTotal: 5 }),
      { id: 't-llm', kind: 'llm', label: '大纲', progressLen: 0, done: 0, chapterTotal: 0, createdAt: 1 },
      task('w2'),
    ]);
    await renderHook();
    await flush();
    expect(fetchActiveTasksMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(latest!.activeByWork)).toEqual(['w1', 'w2']);
    expect(latest!.activeByWork.w1?.done).toBe(2);
  });

  it(`每 ${SHELF_POLL_MS}ms 轮询一拍`, async () => {
    await renderHook();
    await flush();
    expect(fetchActiveTasksMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(SHELF_POLL_MS);
      await Promise.resolve();
    });
    await flush();
    expect(fetchActiveTasksMock).toHaveBeenCalledTimes(2);
  });

  it('终态刷新调用注入的 refreshWorks（diff 出消失的 workId 才刷，结果集不变不刷）', async () => {
    const refresh = vi.fn();
    fetchActiveTasksMock.mockResolvedValueOnce([task('w1')]);
    await renderHook(refresh);
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    // 第二拍：w1 消失（任务终态）
    fetchActiveTasksMock.mockResolvedValueOnce([]);
    await act(async () => {
      vi.advanceTimersByTime(SHELF_POLL_MS);
      await Promise.resolve();
    });
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    // 第三拍：仍为空集——无新增消失（prev 已空），不重复刷新
    fetchActiveTasksMock.mockResolvedValueOnce([]);
    await act(async () => {
      vi.advanceTimersByTime(SHELF_POLL_MS);
      await Promise.resolve();
    });
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('单次轮询抖动（reject）静默：保留上次索引、继续下一拍', async () => {
    fetchActiveTasksMock.mockResolvedValueOnce([task('w1')]);
    await renderHook();
    await flush();
    expect(Object.keys(latest!.activeByWork)).toEqual(['w1']);
    fetchActiveTasksMock.mockRejectedValueOnce(new Error('network blip'));
    await act(async () => {
      vi.advanceTimersByTime(SHELF_POLL_MS);
      await Promise.resolve();
    });
    await flush();
    expect(latest!.activeByWork.w1).toBeDefined();
    // 下一拍恢复
    fetchActiveTasksMock.mockResolvedValueOnce([task('w1', { done: 3 })]);
    await act(async () => {
      vi.advanceTimersByTime(SHELF_POLL_MS);
      await Promise.resolve();
    });
    await flush();
    expect(latest!.activeByWork.w1?.done).toBe(3);
  });

  it('卸载后停止轮询', async () => {
    await renderHook();
    await flush();
    expect(fetchActiveTasksMock).toHaveBeenCalledTimes(1);
    const root = roots.pop()!;
    await act(async () => {
      root.unmount();
    });
    await act(async () => {
      vi.advanceTimersByTime(SHELF_POLL_MS * 3);
      await Promise.resolve();
    });
    expect(fetchActiveTasksMock).toHaveBeenCalledTimes(1);
  });
});

describe('useShelfBatch 多选状态机', () => {
  it('进入/勾选/取消勾选/退出（退出清空选择）', async () => {
    await renderHook();
    expect(latest!.batchMode).toBe(false);
    act(() => {
      latest!.enterBatchMode();
    });
    expect(latest!.batchMode).toBe(true);
    act(() => {
      latest!.toggleWork('w1');
      latest!.toggleWork('w2');
    });
    expect([...latest!.selectedIds]).toEqual(['w1', 'w2']);
    act(() => {
      latest!.toggleWork('w1');
    });
    expect([...latest!.selectedIds]).toEqual(['w2']);
    act(() => {
      latest!.exitBatchMode();
    });
    expect(latest!.batchMode).toBe(false);
    expect(latest!.selectedIds.size).toBe(0);
  });

  it('dialogOpen 开合', async () => {
    await renderHook();
    expect(latest!.dialogOpen).toBe(false);
    act(() => {
      latest!.enterBatchMode();
      latest!.toggleWork('w1');
      latest!.openDialog();
    });
    expect(latest!.dialogOpen).toBe(true);
    act(() => {
      latest!.closeDialog();
    });
    expect(latest!.dialogOpen).toBe(false);
    // 提交完成关闭 = 退出多选（选择清空，卡片徽标接管进度展示）
    expect(latest!.batchMode).toBe(false);
    expect(latest!.selectedIds.size).toBe(0);
  });
});
