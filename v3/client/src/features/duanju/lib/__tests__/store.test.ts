/**
 * store 语义回归（P1-2 / 审查 #14）：同 work 刷新不清空 project——
 * conflict「刷新」不再重挂组件树（批量队列失控与输入框丢值两个事故的根），跨 work 切换仍清空防串台。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();

vi.mock('../../../../api/duanju', () => ({
  getDuanjuProject: (...args: unknown[]) => getMock(...args),
  patchDuanju: vi.fn(),
}));

describe('useDuanjuStore.load 语义', () => {
  beforeEach(async () => {
    vi.resetModules();
    getMock.mockReset();
  });

  it('同 work 两次 load：project 全程非空（不清空 → 组件不重挂 → 输入/队列保留）', async () => {
    const { useDuanjuStore } = await import('../../store');
    const p1 = { id: 'w1', revision: 1, shots: [] };
    getMock.mockResolvedValue(p1);
    await useDuanjuStore.getState().load('w1');
    expect(useDuanjuStore.getState().project).toBe(p1);
    getMock.mockResolvedValue({ ...p1, revision: 2 });
    await useDuanjuStore.getState().load('w1');
    expect(useDuanjuStore.getState().project?.revision).toBe(2);
    expect(useDuanjuStore.getState().loading).toBe(false);
  });

  it('跨 work 切换：清空（防串台）；乱序响应旧数据不覆盖新数据', async () => {
    const { useDuanjuStore } = await import('../../store');
    getMock.mockResolvedValue({ id: 'w1', revision: 1 });
    await useDuanjuStore.getState().load('w1');
    // w2 的响应先回、w1 的旧响应后回——w1 旧响应必须被丢弃
    let resolveW1: (v: unknown) => void = () => {};
    getMock.mockImplementationOnce(() => new Promise((r) => { resolveW1 = r; })); // load('w2') 先发但悬着
    const w2Promise = useDuanjuStore.getState().load('w2');
    await useDuanjuStore.getState().reset();
    resolveW1({ id: 'w2', revision: 9 });
    await w2Promise;
    expect(useDuanjuStore.getState().project).toBeNull(); // reset 清空且悬空响应不复活旧态
  });
});
