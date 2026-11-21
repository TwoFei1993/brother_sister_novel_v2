/**
 * 全局 novel-gen 并发编排器测试（设计共识 D7 / M2 Task 1.2）：
 * FIFO 排队 + 默认并发 2 + env NOVEL_GEN_PARALLEL 实时读（clamp 到 [1,4]）。
 * 判定「排队/放行」全用 microtask 冲刷（实现为纯微任务调度，无宏任务），
 * 不引入真实 sleep，保持测试瞬时完成。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acquireNovelSlot,
  queuedNovelCount,
  releaseNovelSlot,
  runningNovelCount,
} from '../services/novelQueue';

/** microtask 冲刷若干轮：冲刷后旁路标记仍未置位即判定「仍在排队」 */
async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
}

/** 观测 promise 是否已 settle（旁路 then 打标记，不影响被测 promise 本身） */
async function isSettled(p: Promise<void>): Promise<boolean> {
  let done = false;
  void p.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  await flush();
  return done;
}

/** 防御性清场：release 会把槽位转移给队首 waiter，循环至 running 归零即全空 */
function drainAll(): void {
  while (runningNovelCount() > 0) releaseNovelSlot();
}

beforeEach(() => {
  drainAll(); // 上一个用例若有残留占用，先清干净
  delete process.env.NOVEL_GEN_PARALLEL; // 回到默认并发 2 基线
});

afterEach(() => {
  drainAll();
  delete process.env.NOVEL_GEN_PARALLEL;
});

describe('novelQueue 全局并发编排器', () => {
  it('并发 2：前两个 acquire 立即过，第三个排队，release 后队首放行（running 保持=槽位转移）', async () => {
    const p1 = acquireNovelSlot();
    const p2 = acquireNovelSlot();
    expect(runningNovelCount()).toBe(2);
    expect(queuedNovelCount()).toBe(0);
    expect(await isSettled(p1)).toBe(true);
    expect(await isSettled(p2)).toBe(true);

    const p3 = acquireNovelSlot(); // 满槽 → 入 FIFO 队列
    expect(runningNovelCount()).toBe(2);
    expect(queuedNovelCount()).toBe(1);
    expect(await isSettled(p3)).toBe(false); // 仍未放行

    releaseNovelSlot(); // 出列者立即占槽：running 保持 2
    expect(queuedNovelCount()).toBe(0);
    expect(runningNovelCount()).toBe(2);
    expect(await isSettled(p3)).toBe(true);

    releaseNovelSlot();
    releaseNovelSlot();
    expect(runningNovelCount()).toBe(0);
    expect(queuedNovelCount()).toBe(0);
  });

  it('FIFO 顺序：三个 waiter 严格按入队顺序放行', async () => {
    process.env.NOVEL_GEN_PARALLEL = '1'; // 上限 1：除首个外全部入队
    const order: string[] = [];
    await acquireNovelSlot();
    void acquireNovelSlot().then(() => order.push('a'));
    void acquireNovelSlot().then(() => order.push('b'));
    void acquireNovelSlot().then(() => order.push('c'));
    expect(queuedNovelCount()).toBe(3);

    releaseNovelSlot();
    await flush();
    expect(order).toEqual(['a']);
    releaseNovelSlot();
    await flush();
    expect(order).toEqual(['a', 'b']);
    releaseNovelSlot();
    await flush();
    expect(order).toEqual(['a', 'b', 'c']);
    releaseNovelSlot();
    expect(runningNovelCount()).toBe(0);
  });

  it('env NOVEL_GEN_PARALLEL=1：第二个 acquire 即排队', async () => {
    process.env.NOVEL_GEN_PARALLEL = '1';
    await acquireNovelSlot();
    expect(runningNovelCount()).toBe(1);
    void acquireNovelSlot();
    expect(runningNovelCount()).toBe(1);
    expect(queuedNovelCount()).toBe(1);
    drainAll();
    expect(runningNovelCount()).toBe(0);
    expect(queuedNovelCount()).toBe(0);
  });

  it.each([
    ['4', 4],
    ['100', 4], // 越界夹到上限 4
    ['-3', 1], // 负值夹到下限 1
    ['abc', 2], // 非法值 NaN 回落默认 2
    ['0', 2], // Number 0 falsy 回落默认 2
  ])('env NOVEL_GEN_PARALLEL=%s → 并发上限 %i（clamp 到 [1,4]）', (raw, expected) => {
    process.env.NOVEL_GEN_PARALLEL = raw;
    for (let i = 0; i < 6; i += 1) void acquireNovelSlot();
    expect(runningNovelCount()).toBe(expected); // 实时读 env：即时过槽者恰为上限
    expect(queuedNovelCount()).toBe(6 - expected);
    drainAll();
    expect(runningNovelCount()).toBe(0);
    expect(queuedNovelCount()).toBe(0);
  });

  it('release 超额 no-op：running 为 0 时不抛错、计数不变', () => {
    expect(() => releaseNovelSlot()).not.toThrow();
    expect(() => releaseNovelSlot()).not.toThrow();
    expect(runningNovelCount()).toBe(0);
    expect(queuedNovelCount()).toBe(0);
  });

  it('计数观测：初始 0/0，占槽/排队/出列全程计数准确', async () => {
    expect(runningNovelCount()).toBe(0);
    expect(queuedNovelCount()).toBe(0);
    await acquireNovelSlot();
    const p2 = acquireNovelSlot();
    const p3 = acquireNovelSlot();
    expect(runningNovelCount()).toBe(2);
    expect(queuedNovelCount()).toBe(1);
    expect(await isSettled(p2)).toBe(true);
    expect(await isSettled(p3)).toBe(false);
    releaseNovelSlot(); // p3 出列占槽
    expect(runningNovelCount()).toBe(2);
    expect(queuedNovelCount()).toBe(0);
    releaseNovelSlot();
    releaseNovelSlot();
    expect(runningNovelCount()).toBe(0);
    expect(queuedNovelCount()).toBe(0);
  });
});
