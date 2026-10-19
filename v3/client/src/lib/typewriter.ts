/**
 * 打字机匀速器：把 API 返回的文字块（可能一大坨）平滑成逐字显示。
 *
 * 工作方式：
 * - push() 把 SSE 收到的文字塞进缓冲区，并启动一个定时器
 * - 定时器每个 tick 从缓冲区取 N 个字回调给 onEmit（N 随缓冲区积压自适应加速）
 * - drained() 等缓冲区全部吐完（生成结束时调用，避免最后一屏突然弹出）
 * - flushSync() 立刻吐完剩余内容（停止/出错时调用，保证不丢字）
 */
export class TypewriterPacer {
  private buffer = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private drainedResolvers: Array<() => void> = [];
  private stopped = false;

  constructor(
    private onEmit: (text: string) => void,
    /** 每次 tick 间隔（ms），约 42fps；<=0 时 push 直通（测试注入/降级） */
    private intervalMs = 24,
    /** 缓冲区再空也至少每 tick 吐几个字（保证基础打字速度） */
    private baseCharsPerTick = 2,
    /** 缓冲区积压越多吐得越快：每积压 N 个字多吐 1 个 */
    private catchUpDivisor = 10,
    /** 单 tick 吐字上限（封顶追赶速度，避免整章一次性砸出来） */
    private maxCharsPerTick = 30,
  ) {}

  push(text: string) {
    if (this.stopped || !text) return;
    if (this.intervalMs <= 0) {
      this.onEmit(text);
      return;
    }
    this.buffer += text;
    this.ensureTimer();
  }

  /** 所有已 push 的文字都吐完时 resolve */
  drained(): Promise<void> {
    if (this.stopped || !this.buffer) return Promise.resolve();
    return new Promise((resolve) => this.drainedResolvers.push(resolve));
  }

  /** 立即吐完剩余内容并停表（停止生成 / 出错时用，不丢已收到内容） */
  flushSync() {
    if (this.buffer) {
      const rest = this.buffer;
      this.buffer = '';
      this.onEmit(rest);
    }
    this.stop();
  }

  stop() {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.resolveDrained();
  }

  private ensureTimer() {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  private tick() {
    if (!this.buffer) {
      // 空转自愈：吐完即停表（正常流式下大部分 tick 缓冲为空），push 会经 ensureTimer 重新起表
      if (this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
      return;
    }
    const n = Math.min(
      this.maxCharsPerTick,
      Math.max(this.baseCharsPerTick, Math.ceil(this.buffer.length / this.catchUpDivisor)),
    );
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.slice(n);
    this.onEmit(out);
    if (!this.buffer) this.resolveDrained();
  }

  private resolveDrained() {
    if (this.drainedResolvers.length === 0) return;
    const resolvers = this.drainedResolvers;
    this.drainedResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }
}
