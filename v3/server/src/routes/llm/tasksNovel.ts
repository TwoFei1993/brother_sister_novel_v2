/**
 * novel-chapter 任务类型基建（M2「全后台生成」Task 1.1）：
 * 提交 schema（prefs/编排参数）/ 同书互斥扫描 / 占位执行器（Task 3.3 实装编排）。
 *
 * 本文件同时是 llm-tasks 目录路径的公共底层：llmTasksDir() 是该目录布局的唯一权威，
 * tasks.ts（taskFile）、tasksExecute.ts（taskFileOf）、测试文件均基于它拼路径，
 * 互相引用不构成运行时循环（本文件不反向 import 任何 tasks 组的运行时值）。
 *
 * 与 tasks.ts 的依赖方向：tasks.ts → 本文件（值导入单向）；
 * 本文件仅 type-only 反向引用 TaskFile（编译期擦除，无运行时循环依赖）。
 */
import { join } from 'node:path';
import { z } from 'zod';

import { readJson, listDir } from '../../storage/store';
import { dataDir } from '../core/paths';
import type { TaskFile } from './tasks';

/** llm-tasks 目录布局唯一权威：每次实时解析 env DATA_DIR（与路由层实时读 env 约定一致，测试可覆盖） */
export function llmTasksDir(): string {
  return join(dataDir(), 'llm-tasks');
}

/** 与 routes/llm.ts 同源（内联避免循环依赖）——本文件是唯一权威，tasks.ts 反向导入 */
export const sourceSchema = z.enum(['openai', 'claude', 'gemini']);

/**
 * 章节生成参数（模型通道与采样偏好；repetitionPenalty 为治重复循环三道防线之二）。
 * 与 client stores/settings.ts 的 LlmPrefs 正文生成相关字段一一对应，
 * 新增字段须双侧同步（zod strip 模式会静默丢弃未声明字段）。
 */
export const prefsSchema = z.object({
  source: sourceSchema,
  model: z.string().min(1),
  temperature: z.number().optional(),
  maxContext: z.number().optional(),
  maxTokens: z.number().optional(),
  thinking: z.boolean().optional(),
  polishModel: z.string().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  repetitionPenalty: z.number().optional(),
});

export const novelChapterSchema = z.object({
  kind: z.literal('novel-chapter'),
  workId: z.string().min(1),
  prefs: prefsSchema,
  mode: z.enum(['chapter', 'swipe', 'continue', 'append', 'expand']).default('chapter'),
  directive: z.string().default(''),
  chapters: z.number().int().min(1).max(50).default(1),
  outline: z.boolean().default(false), // true=第 2..N 章用大纲链
  targetId: z.string().optional(), // swipe/append/expand 目标消息 id
  partial: z.string().optional(), // continue 半成品基底
});

export type NovelChapterBody = z.infer<typeof novelChapterSchema>;

/**
 * 扫描任务目录中 status∈{pending,running} 的任务（可选谓词收窄）。
 * 互斥判定 / active 列表共用；损坏文件告警后跳过（不阻塞列表）。
 */
export async function scanActiveTasks(dir: string, pred?: (t: TaskFile) => boolean): Promise<TaskFile[]> {
  const names = (await listDir(dir)).filter((n) => n.endsWith('.json')); // 精确后缀：排除 .json.tmp 中间态
  const out: TaskFile[] = [];
  for (const name of names) {
    const task = await readJson<TaskFile>(join(dir, name)).catch((err) => {
      // readJson 对不存在返回 null 不走这里——catch 到即文件存在但损坏，告警区分于正常跳过
      console.warn('[llm-tasks] 任务文件损坏，扫描跳过：', join(dir, name), err);
      return null;
    });
    if (!task) continue;
    if (task.status !== 'pending' && task.status !== 'running') continue;
    if (pred && !pred(task)) continue;
    out.push(task);
  }
  return out;
}

/**
 * novel-chapter 后台执行占位（Task 3.3 实装组装与编排——本任务只保证
 * 提交/查询/取消/互斥全链路真实可用：占位在可注入延迟后 throw，由
 * POST handler 的统一 catch 落盘 failed，客户端立即可见明确错误）。
 * 延迟仅供本任务测试锁定 pending 窗口（互斥/取消用例），生产默认 0 即时失败。
 */
export async function executeNovelChapter(_task: TaskFile): Promise<void> {
  const delay = Number(process.env.LLM_TASK_NOVEL_DELAY_MS ?? 0);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  throw new Error('novel-chapter 执行尚未实装（M2 Task 3.3）');
}
