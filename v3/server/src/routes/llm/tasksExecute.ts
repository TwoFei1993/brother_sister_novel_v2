/**
 * LLM 后台任务执行器（kind='llm' 单次调用；与路由层分离——tasks.ts 只管协议与状态机）
 *
 * 稳定性三级防线（①瞬态退避 ②预算加倍 ③灾备通道）已下沉至 services/llm.collectWithDefense
 * （M2 Task 3.2：novel 章节编排共用同一实现；本文件只保留任务语义的起始预算与终态写盘）。
 */
import { join } from 'node:path';

import { readJson, writeJsonAtomic } from '../../storage/store';
import { collectWithDefense } from '../../services/llm/defense';
import { llmTasksDir } from './tasksNovel';
import type { TaskFile } from './tasks';

/** writeJsonAtomic 的 Windows 加固：EPERM（读者占用+rename 撞车）重试 3 次（cancel 落盘共用） */
export async function writeJsonAtomicRetry(file: string, data: unknown): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    try {
      await writeJsonAtomic(file, data);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!/EPERM|EBUSY/.test(msg) || i === 2) throw err;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

export async function execute(task: TaskFile, source: 'openai' | 'claude' | 'gemini', model: string): Promise<void> {
  const t0 = Date.now();
  const messages = task.messages ?? [];
  const baseParams = task.params ?? {};
  // 起始预算：thinking 任务下限 32000（推理模型思考流与正文共用 max_tokens，8192 必被思考吃满）
  const initialMaxTokens = Math.max(Number(baseParams.max_tokens ?? 8192), task.thinking === false ? 8192 : 32000);
  const r = await collectWithDefense({
    source,
    model,
    messages,
    params: { ...baseParams, thinking: task.thinking },
    maxTokens: initialMaxTokens,
  });
  const { text, lastErr } = r;

  // 写前合并磁盘最新态（终态写硬约束）：终态写不得回滚执行期间并发落盘的其他字段
  // （典型：cancel 置位的 cancelRequested）。磁盘读不到（损坏/被清）时以内存 task 打底。
  // 同样约束适用于 Task 3.3 runner 的 progress 节流写——不合并会抹掉取消标志。
  const disk = await readJson<TaskFile>(taskFileOf(task.id)).catch(() => null);
  const next: TaskFile = {
    ...(disk ?? task),
    status: text.trim() ? 'done' : 'failed',
    text: text.trim() || undefined,
    error: text.trim() ? undefined : `${lastErr || '模型无输出（预算加倍后仍空）'}（主通道+灾备通道均无产出）`,
    elapsedMs: Date.now() - t0,
    messages: undefined,
    params: undefined,
    progress: undefined, // 终态清执行期增量
  };
  await writeJsonAtomicRetry(taskFileOf(task.id), next);
}

/** 任务文件路径（布局来自 tasksNovel.llmTasksDir 唯一权威） */
function taskFileOf(id: string): string {
  return join(llmTasksDir(), `${id}.json`);
}
