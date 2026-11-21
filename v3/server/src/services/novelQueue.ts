/**
 * 全局 novel-gen 并发编排器（设计共识 D7 / M2 Task 1.2）：
 * FIFO 排队，默认并发 2（env NOVEL_GEN_PARALLEL 可调 1-4）。
 * 批量并发参数（Chunk 6 弹窗）：最近一次提交显式设置的 desiredParallel 优先于 env
 * 基线——内存态，server 重启回落 env 默认（可接受：意图随最近一次批量提交重建）。
 * 仅约束 novel-chapter 任务（executeNovelChapter 外围 acquire/release，Task 3.3 接入）；
 * 普通 llm 任务不受限（现状）。单进程内存态——编排器只在内存，文件是事实源。
 */

/** 已占槽（执行中）的 novel 任务数 */
let running = 0;

/** FIFO 等待队列：release 转移槽位时队首先出列 resolve */
const waiters: Array<() => void> = [];

/** 最近一次显式设置的并发期望（批量提交带 parallel 时更新；null=未设置走 env 基线） */
let desiredParallel: number | null = null;

/** 并发上限实时解析：显式设置优先；未设置回落 env 公式（越界夹取 [1,4]，NaN/0 等 falsy 回落默认 2，env 实时读约定，测试可动态注入） */
function novelParallelLimit(): number {
  if (desiredParallel !== null) return desiredParallel;
  return Math.min(4, Math.max(1, Number(process.env.NOVEL_GEN_PARALLEL ?? '2') || 2));
}

/**
 * 设置期望并发（POST novel-chapter 带 parallel 时调用；最近一次设置生效，clamp 到 [1,4]）。
 * 调高上限时主动放行：waiters 队首按新 limit 逐个出列占槽（running 可超过旧上限）；
 * 调低不中断已 running（超额者继续跑，新 acquire 自然排队）——release 转移逻辑不变。
 */
export function setDesiredParallel(n: number): void {
  desiredParallel = Math.min(4, Math.max(1, Math.trunc(n)));
  while (running < novelParallelLimit() && waiters.length > 0) {
    running += 1;
    waiters.shift()!(); // 出列者立即占槽（新槽位：running +1，区别于 release 的槽位转移）
  }
}

/** 清除显式设置（回落 env 基线；测试清场用） */
export function resetDesiredParallel(): void {
  desiredParallel = null;
}

/** 占槽：有余位立即返回（running+1）；否则入 FIFO 队列，等 release/调高放行后 resolve */
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
