/**
 * 后台 LLM 任务的提交与轮询（流水线专用，设计共识 2026-11-26 第 3.6 节）
 *
 * 与 lib/llmTask.ts（界面用的 slot 机制）不同：这里把 taskId 交给调用方保管——
 * 流水线把它写进断点，页面被回收后下次先查这个任务的状态而不是重提（服务端任务照跑完，结果不浪费）。
 * 超时按实际轮询次数算，不按墙上时钟——手机切后台回来，墙上时钟过了很久但任务还在跑。
 */
import { apiFetch } from '../../../../api/client';
import type { GenerateMessage } from '../../../../api/llm';

export interface BgTaskBody {
  source: string;
  model: string;
  messages: GenerateMessage[];
  params?: Record<string, unknown>;
  thinking?: boolean;
  label?: string;
}

export type BgTaskStatus =
  | { status: 'running' }
  | { status: 'done'; text: string }
  | { status: 'failed'; error?: string }
  | { status: 'lost' | 'expired'; error?: string };

export const BG_POLL_MS = 1500;
/** 活跃轮询上限（400 × 1.5 秒 ≈ 10 分钟实际轮询时间） */
export const BG_MAX_POLLS = 400;

/** 轮询默认值（测试把 intervalMs 调成 0） */
export const bgTaskConfig = { intervalMs: BG_POLL_MS, maxPolls: BG_MAX_POLLS };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 服务端对不存在的任务回 404：这不是网络抖动，是任务真的没了（数据目录换过 / 任务被清理） */
const isNotFound = (err: unknown): boolean => (err as { status?: number } | null)?.status === 404;

export async function fetchBgTask(taskId: string): Promise<BgTaskStatus> {
  return apiFetch<BgTaskStatus>(`/api/llm/tasks/${taskId}`);
}

/** 提交后台任务，返回 taskId（服务端没有返回任务号 → 人话报错） */
export async function submitBgTask(body: BgTaskBody): Promise<string> {
  const r = await apiFetch<{ taskId?: string }>('/api/llm/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!r.taskId) throw new Error('任务提交失败（服务端没有返回任务号）');
  return r.taskId;
}

export interface PollOptions {
  /** 轮询间隔（测试传 0） */
  intervalMs?: number;
  maxPolls?: number;
  onPoll?: (n: number) => void;
}

/** 轮询到终态并返回结果文本；失败 / 丢失 / 不存在 / 超时抛人话错误。单次网络抖动静默重试（计入次数上限） */
export async function pollBgTask(taskId: string, opts: PollOptions = {}): Promise<string> {
  const intervalMs = opts.intervalMs ?? bgTaskConfig.intervalMs;
  const maxPolls = opts.maxPolls ?? bgTaskConfig.maxPolls;
  for (let n = 1; n <= maxPolls; n += 1) {
    if (intervalMs > 0) await sleep(intervalMs);
    let j: BgTaskStatus;
    try {
      j = await fetchBgTask(taskId);
    } catch (err) {
      // 不当成抖动硬等：否则要空转满 400 次（约 10 分钟）才报超时，断点里的旧任务号也永远重提不了
      if (isNotFound(err)) throw new Error('后台任务已不存在（服务端清理过任务或换过数据目录），需要重新提交');
      opts.onPoll?.(n);
      continue;
    }
    if (j.status === 'done') return j.text ?? '';
    if (j.status === 'failed') throw new Error(j.error || '生成失败');
    if (j.status !== 'running') throw new Error(j.error || '任务丢失，请重新提交');
    opts.onPoll?.(n);
  }
  throw new Error('生成超时（长时间没有进展），可稍后重试');
}

/**
 * 跑一个后台任务：已有 taskId（断点里的在途任务）先查它的状态——已完成直接取结果、
 * 运行中接着轮询、失败 / 丢失 / 已不存在（404）才重提；没有 taskId 就提交新任务（提交后立刻回调，调用方写断点）。
 */
export async function runBgTask(
  body: BgTaskBody,
  opts: PollOptions & { existingTaskId?: string; onSubmitted?: (taskId: string) => void } = {},
): Promise<string> {
  if (opts.existingTaskId) {
    let known: BgTaskStatus | null = null;
    try {
      known = await fetchBgTask(opts.existingTaskId);
    } catch (err) {
      if (!isNotFound(err)) return pollBgTask(opts.existingTaskId, opts); // 只是网络抖动：按运行中处理，交给轮询
    }
    if (known?.status === 'done') return known.text ?? '';
    if (known?.status === 'running') return pollBgTask(opts.existingTaskId, opts);
    // 其余（失败 / 丢失 / 查不到）：重提
  }
  const taskId = await submitBgTask(body);
  opts.onSubmitted?.(taskId);
  return pollBgTask(taskId, opts);
}
