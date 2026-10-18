// per-work 内存互斥写队列（设计 §4.5）：
// 同一 workId 的写操作串行排队，不同 workId 并行执行；队列实现为 Map<workId, Promise 链>。
// fn 抛错只向上传播给本次调用者，不中断同 workId 的后续排队。

/** 每个 workId 一条 Promise 链，链尾永远处于已定状态（吞错版） */
const queues = new Map<string, Promise<void>>();

/**
 * 将 fn 排入 workId 的写队列并在轮到自己时执行。
 * - 同 workId：严格按调用顺序串行（前一个完成后下一个才开始）。
 * - 不同 workId：完全并行，互不等待。
 * - fn 抛错：原样传播给本次调用者，同时链尾吞错，保证后续排队任务不被污染。
 */
export function withWorkLock<T>(workId: string, fn: () => Promise<T>): Promise<T> {
  // 前序任务无论成败都轮到本任务（前序错误已由各自的调用者处理）
  const prev = queues.get(workId) ?? Promise.resolve();
  const task: Promise<T> = prev.then(fn, fn);

  // 链尾必须吞错：否则 rejected 的链会让下一个任务误入 onRejected，且产生 unhandled rejection
  const tail: Promise<void> = task.then(
    () => undefined,
    () => undefined,
  );
  queues.set(workId, tail);

  // 本任务仍是链尾（其后没有新任务接上）时清理条目，防止 Map 随作品数无限增长
  void tail.then(() => {
    if (queues.get(workId) === tail) queues.delete(workId);
  });

  return task;
}
