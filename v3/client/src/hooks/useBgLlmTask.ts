/**
 * LLM 后台任务 hook（切出 App 后生成继续）：提交 → server 后台执行 → 轮询拉取
 *
 * - taskId 持久化 localStorage（slot 隔离）——切出/刷新后 mount 自动恢复轮询，
 *   完成即回调 onDone（结果不丢）
 * - 失败/过期/丢失 → onError + 清 slot（可重新提交）
 * - server 端预算协商与前端 generateTextOnce 同语义（空输出加倍 ≤4 轮 cap 64000）
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch } from '../api/client';

export interface BgTaskState {
  status: 'submitting' | 'running' | 'done' | 'failed' | 'expired' | 'lost';
  label?: string;
  /** done 时的结果文本 */
  text?: string;
  error?: string;
  /** 已等待秒数（running 时心跳） */
  elapsedSec?: number;
}

const POLL_MS = 3000;
const TASK_TIMEOUT_MS = 20 * 60 * 1000;

/** slot 持久化 key（跨刷新恢复轮询） */
const slotKey = (slot: string): string => `v3-bg-llm-task-${slot}`;

export function useBgLlmTask(slot: string, onDone: (text: string) => void, onError: (msg: string) => void) {
  const [state, setState] = useState<BgTaskState | null>(null);
  const mountedRef = useRef(true);
  const onDoneRef = useRef(onDone);
  const onErrorRef = useRef(onError);
  onDoneRef.current = onDone;
  onErrorRef.current = onError;

  const clearSlot = useCallback(() => localStorage.removeItem(slotKey(slot)), [slot]);

  /** 提交后台任务并开始轮询（组件卸载不中断——server 端继续执行） */
  const submit = useCallback(
    async (body: {
      source: string;
      model: string;
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      params?: Record<string, unknown>;
      thinking?: boolean;
      label?: string;
    }): Promise<void> => {
      setState({ status: 'submitting', label: body.label });
      let taskId: string;
      try {
        const r = await apiFetch<{ taskId: string }>('/api/llm/tasks', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        taskId = r.taskId;
      } catch (err) {
        setState({ status: 'failed', error: err instanceof Error ? err.message : '提交失败' });
        onErrorRef.current(err instanceof Error ? err.message : '提交失败');
        return;
      }
      localStorage.setItem(slotKey(slot), taskId);
      setState({ status: 'running', label: body.label, elapsedSec: 0 });
      void poll(taskId, slot, body.label);
    },
    [slot],
  );

  const poll = useCallback(
    async (taskId: string, taskSlot: string, label?: string): Promise<void> => {
      const t0 = Date.now();
      while (Date.now() - t0 < TASK_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        let j: { status?: string; text?: string; error?: string };
        try {
          j = await apiFetch<{ status: string; text?: string; error?: string }>(`/api/llm/tasks/${taskId}`);
        } catch {
          continue; // 单次轮询抖动静默重试
        }
        if (!mountedRef.current) return; // 组件卸载（页离开）——下次 mount 由 slot 恢复
        if (j.status === 'done') {
          clearSlot();
          setState({ status: 'done', text: j.text, label });
          onDoneRef.current(j.text ?? '');
          return;
        }
        if (j.status === 'failed') {
          clearSlot();
          setState({ status: 'failed', error: j.error, label });
          onErrorRef.current(j.error ?? '生成失败');
          return;
        }
        if (j.status === 'lost' || j.status === 'expired') {
          clearSlot();
          setState({ status: j.status as 'lost' | 'expired', error: j.error, label });
          onErrorRef.current(j.error ?? '任务丢失，请重新提交');
          return;
        }
        setState({ status: 'running', label, elapsedSec: Math.round((Date.now() - t0) / 1000) });
      }
      clearSlot();
      setState({ status: 'failed', error: '超时（20 分钟未完成）', label });
      onErrorRef.current('超时（20 分钟未完成）');
    },
    [clearSlot],
  );

  /** 恢复轮询（mount/visibilitychange 时由 pane 调用）：slot 有未完成任务 → 继续轮询 */
  const resume = useCallback((): void => {
    const taskId = localStorage.getItem(slotKey(slot));
    if (!taskId) return;
    void (async () => {
      let j: { status?: string; text?: string; error?: string };
      try {
        j = await apiFetch<{ status: string; text?: string; error?: string }>(`/api/llm/tasks/${taskId}`);
      } catch {
        return; // 网络抖动——下次可见时再试
      }
      if (!mountedRef.current) return;
      if (j.status === 'done') {
        clearSlot();
        setState({ status: 'done', text: j.text, label: undefined });
        onDoneRef.current(j.text ?? '');
      } else if (j.status === 'running') {
        setState({ status: 'running' });
        void poll(taskId, slot);
      } else if (j.status === 'failed' || j.status === 'lost' || j.status === 'expired') {
        clearSlot();
        setState({ status: j.status as 'failed' | 'lost' | 'expired', error: j.error, label: undefined });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);

  // 移动端切回 App 时立即续轮询（iOS/Android 后台冻结会暂停轮询定时器——
  // visibilitychange visible 是系统恢复信号，此时检查 slot 任务状态补上进度）
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') resume();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [resume]);

  return { state, submit, resume, clear: clearSlot };
}

/** 供 pane 手动调用 resume 的便捷包装（非 hook，mount 时一次性） */
export function resumeBgLlmTask(slot: string, onDone: (text: string) => void): void {
  const taskId = localStorage.getItem(slotKey(slot));
  if (!taskId) return;
  void (async () => {
    try {
      const j = await apiFetch<{ status: string; text?: string; error?: string }>(`/api/llm/tasks/${taskId}`);
      if (j.status === 'done') {
        clearSlotOf(slot);
        onDone(j.text ?? '');
      }
    } catch {
      /* 忽略 */
    }
  })();
}

function clearSlotOf(slot: string): void {
  localStorage.removeItem(slotKey(slot));
}
