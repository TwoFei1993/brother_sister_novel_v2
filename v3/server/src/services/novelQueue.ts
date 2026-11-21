/**
 * 全局 novel-gen 并发编排器（设计共识 D7 / M2 Task 1.2）：
 * FIFO 排队，默认并发 2（env NOVEL_GEN_PARALLEL 可调 1-4）。
 * 仅约束 novel-chapter 任务（executeNovelChapter 外围 acquire/release，Task 3.3 接入）；
 * 普通 llm 任务不受限（现状）。单进程内存态——编排器只在内存，文件是事实源。
 */

/** 已占槽（执行中）的 novel 任务数 */
let running = 0;

/** FIFO 等待队列：release 转移槽位时队首先出列 resolve */
const waiters: Array<() => void> = [];

/** 并发上限实时解析：越界值夹取到 [1,4]，NaN/0 等 falsy 回落默认 2（env 实时读约定，测试可动态注入） */
function novelParallelLimit(): number {
  return Math.min(4, Math.max(1, Number(process.env.NOVEL_GEN_PARALLEL ?? '2') || 2));
}

/** 占槽：有余位立即返回（running+1）；否则入 FIFO 队列，等 release 转移槽位后 resolve */
export function acquireNovelSlot(): Promise<void> {
  if (running < novelParallelLimit()) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
}

/** 释放槽位：waiters 非空则槽位直接转移给队首（running 保持）；running 为 0 时防御性 no-op */
export function releaseNovelSlot(): void {
  if (running <= 0) return;
  const next = waiters.shift();
  if (!next) {
    running -= 1;
    return;
  }
  next(); // 出列者立即占槽：running 不减不增
}

/** 观测：当前执行中的 novel 任务数 */
export function runningNovelCount(): number {
  return running;
}

/** 观测：当前排队等待槽位的任务数 */
export function queuedNovelCount(): number {
  return waiters.length;
}
