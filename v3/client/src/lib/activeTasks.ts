/**
 * /api/llm/tasks/active 共享客户端（Chunk 6：书架批量与顶栏指示两处 5s 轮询复用）
 *
 * - fetchActiveTasks：进行中任务列表（网络/服务抖动抛错——轮询方静默保留上次值）
 * - novelTasksByWork：novel-chapter 任务按 workId 索引（书架卡片徽标数据源）
 * - phaseLabel：执行相位中文映射（卡片徽标消费）
 * 响应形状镜像 server routes/llm/tasks.ts GET /active；顶栏侧 useActiveGenCount 与
 * 书架侧 useShelfBatch 各自独立轮询（轻量列表接口，两份可接受）。
 */
import { apiFetch } from '../api/client';
import type { NovelTaskProgressPayload } from './llmTask';

/** 任务执行相位（GET /active 与 GET ?since=N 增量同源，类型锚定 lib/llmTask） */
export type TaskPhase = NovelTaskProgressPayload['phase'];

/** GET /active 列表项（server 契约镜像；llm 任务无 workId/徽标相位可缺省） */
export interface ActiveTask {
  id: string;
  kind: 'llm' | 'novel-chapter';
  workId?: string;
  label?: string;
  progressLen: number;
  done: number;
  chapterTotal: number;
  phase?: TaskPhase;
  createdAt: number;
}

/** 进行中任务列表（GET /api/llm/tasks/active） */
export async function fetchActiveTasks(): Promise<ActiveTask[]> {
  const j = await apiFetch<{ tasks?: ActiveTask[] }>('/api/llm/tasks/active');
  return j.tasks ?? [];
}

/** novel-chapter 任务按 workId 索引：llm 任务与缺 workId 的条目不入索引 */
export function novelTasksByWork(tasks: ActiveTask[]): Record<string, ActiveTask> {
  const out: Record<string, ActiveTask> = {};
  for (const t of tasks) {
    if (t.kind === 'novel-chapter' && t.workId) out[t.workId] = t;
  }
  return out;
}

/** 相位中文映射（徽标 `第x/y章·相位` 消费） */
const PHASE_LABELS: Record<TaskPhase, string> = {
  assembling: '组装中',
  generating: '生成中',
  continuing: '续写中',
  polishing: '润色中',
  saving: '入库中',
};

/** 无相位（任务已受理未开始/pending）→ 排队中 */
export function phaseLabel(phase: TaskPhase | undefined): string {
  return phase ? PHASE_LABELS[phase] : '排队中';
}
