/**
 * 全局轻量 toast（发布/订阅，零依赖）：连写章节完成提示、批量任务汇总等非阻塞通知。
 *
 * - showToast(text, opts)：任意模块直接调用（无需 hook/组件上下文）
 * - ToastHost（挂在 App 根部）订阅并渲染——自动消失（默认 3.5s）
 * - 与 alert/confirm 的区别：不阻塞、可堆叠、生成流程中不打断
 */

export interface ToastItem {
  id: number;
  text: string;
  /** 停留时长 ms（0 = 手动关闭） */
  duration: number;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
/** useSyncExternalStore 的稳定快照（仅 items 变化时替换引用，避免无限重渲染） */
let snapshot: ToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void {
  snapshot = [...items];
  listeners.forEach((l) => l(snapshot));
}

/** useSyncExternalStore 的 getSnapshot（ToastHost 消费） */
export function getToastSnapshot(): ToastItem[] {
  return snapshot;
}

/** 弹一条全局提示（生成完成/批量进度等）；返回 id 便于测试或手动清除 */
export function showToast(text: string, opts?: { duration?: number }): number {
  const id = ++seq;
  const duration = opts?.duration ?? 3500;
  items = [...items, { id, text, duration }].slice(-4); // 最多同时 4 条
  emit();
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), duration),
    );
  }
  return id;
}

export function dismissToast(id: number): void {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  items = items.filter((i) => i.id !== id);
  emit();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 轻提示音（Web Audio 短双音「叮咚」，无资源文件依赖；批量完成时提示） */
export function chime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    gain.connect(ctx.destination);
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.1);
    });
    setTimeout(() => void ctx.close(), 500);
  } catch {
    /* 音频不可用静默（自动播放策略等） */
  }
}

/** 提示 + 提示音（生成完成类通知的统一入口） */
export function notifyDone(text: string, opts?: { duration?: number }): void {
  showToast(text, opts);
  chime();
}
