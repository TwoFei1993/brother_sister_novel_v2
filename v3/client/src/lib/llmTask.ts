/**
 * LLM 后台任务通用客户端（切出 App 后生成继续——手机锁屏/切后台安全）
 *
 * 机制：生成在 server 端后台执行（POST /api/llm/tasks → server 调上游落盘），
 * 浏览器只做轮询——页面冻结/切后台不影响 server 端任务；切回（visibilitychange
 * visible）自动重启轮询；结果写 localStorage（跨页面生命周期存活），消费后清除。
 *
 * 使用模式（调用方）：
 *   submitTask(slot, body)                    提交（slot 隔离）
 *   await waitAndStore(slot, onElapsed?)      轮询至完成，结果写 localStorage 并返回
 *   consumeResult(slot)                       消费结果（读+清），无则 null
 *   resumeIfPending(slot)                     mount/visibilitychange：有 pending → 重启轮询
 */

const CFG = {
  taskKey: (slot: string): string => `v3-bg-task-${slot}`,
  resultKey: (slot: string): string => `v3-bg-result-${slot}`,
};

export interface BgTaskBody {
  source: string;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  params?: Record<string, unknown>;
  thinking?: boolean;
  label?: string;
}

// ---------- 内部 HTTP ----------

async function fetchJson(path: string): Promise<{ status?: string; text?: string; error?: string }> {
  const r = await fetch(path, { credentials: 'include' });
  const j = (await r.json().catch(() => ({}))) as { status?: string; text?: string; error?: string };
  if (!r.ok && r.status !== 410 && r.status !== 404) throw new Error(`HTTP ${r.status}`);
  return j;
}

async function apiPost(path: string, body: unknown): Promise<{ taskId: string }> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`任务提交失败（HTTP ${r.status}）：${t.slice(0, 160)}`);
  }
  return (await r.json()) as { taskId: string };
}

const POLL_MS = 3000;
const TASK_TIMEOUT_MS = 20 * 60 * 1000;

// ---------- 公开 API ----------

/** 提交后台任务（POST /api/llm/tasks），taskId 写 localStorage */
export async function submitTask(slot: string, body: BgTaskBody): Promise<void> {
  const r = await apiPost('/api/llm/tasks', body);
  localStorage.setItem(CFG.taskKey(slot), r.taskId);
}

/** 任务当前状态（pending 文件存在即 running 语义） */
export function taskPending(slot: string): boolean {
  return Boolean(localStorage.getItem(CFG.taskKey(slot)));
}

/** 读结果（不消费）——done 落盘的全文 */
export function peekResult(slot: string): string | null {
  return localStorage.getItem(CFG.resultKey(slot));
}

/** 消费结果（读+清）——无则 null（尚未完成） */
export function consumeResult(slot: string): string | null {
  const t = localStorage.getItem(CFG.resultKey(slot));
  if (t === null) return null;
  localStorage.removeItem(CFG.resultKey(slot));
  return t;
}

/** 清 pending 标记（消费/失败/过期后） */
export function clearPending(slot: string): void {
  localStorage.removeItem(CFG.taskKey(slot));
}

/**
 * 轮询至完成并把结果写 localStorage（跨页面生命周期存活）。
 * 页面冻结/切后台时本 promise 链会断——断点安全：结果在 server draft 永久保留，
 * visibilitychange visible / mount 时调 resumeIfPending 重启轮询续完。
 */
export async function waitAndStore(slot: string, onElapsed?: (sec: number) => void): Promise<string> {
  const taskId = localStorage.getItem(CFG.taskKey(slot));
  if (!taskId) throw new Error('无进行中的后台任务');
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const elapsedSec = Math.round((Date.now() - t0) / 1000);
    onElapsed?.(elapsedSec);
    let j: { status?: string; text?: string; error?: string };
    try {
      j = await fetchJson(`/api/llm/tasks/${taskId}`);
    } catch {
      continue; // 单次轮询抖动静默重试
    }
    if (j.status === 'done') {
      localStorage.setItem(CFG.resultKey(slot), j.text ?? '');
      localStorage.removeItem(CFG.taskKey(slot));
      return j.text ?? '';
    }
    if (j.status === 'failed') {
      localStorage.removeItem(CFG.taskKey(slot));
      throw new Error(j.error ?? '生成失败');
    }
    if (j.status === 'lost' || j.status === 'expired') {
      localStorage.removeItem(CFG.taskKey(slot));
      throw new Error(j.error ?? '任务丢失，请重新提交');
    }
    if (Date.now() - t0 > TASK_TIMEOUT_MS) {
      localStorage.removeItem(CFG.taskKey(slot));
      throw new Error('超时（20 分钟未完成）');
    }
  }
}

/** mount / 切回可见：slot 有 pending 且无 result → 重启轮询续完（页面冻结断点安全） */
export function resumeIfPending(slot: string, onElapsed?: (sec: number) => void): void {
  if (!taskPending(slot) || peekResult(slot) !== null) return;
  void waitAndStore(slot, onElapsed).catch(() => {
    clearPending(slot); // 轮询链错误终态——清标记允许重新提交
  });
}
