/**
 * novel-chapter 任务类型基建（M2 Task 1.1 提交协议 / Task 3.3 runner 实装）：
 * 提交 schema（prefs/编排参数）/ 同书互斥扫描 / 后台执行器。
 *
 * 本文件同时是 llm-tasks 目录路径的公共底层：llmTasksDir() 是该目录布局的唯一权威，
 * tasks.ts（taskFile）、tasksExecute.ts（taskFileOf）、测试文件均基于它拼路径。
 *
 * 与 tasks.ts 的依赖方向：tasks.ts → 本文件（值导入单向）；
 * 本文件仅 type-only 反向引用 TaskFile（编译期擦除，无运行时循环依赖）。
 *
 * runner（Task 3.3）：acquireNovelSlot（全局并发编排器 D7）→ orchestrateNovelChapters
 * （章循环/模式编排全在 services/novel-gen）→ 终态写 {status, resultMessages,
 * resultMessageIds}；进度经 1s 节流器落盘（合并磁盘最新态——硬约束：不合并会抹掉
 * 执行期间并发落盘的 cancelRequested）；isCancelled 每次重读任务文件。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { readJson, listDir, writeJsonAtomicRetry } from '../../storage/store';
import { acquireNovelSlot, releaseNovelSlot } from '../../services/novelQueue';
import {
  orchestrateNovelChapters,
  type OrchestrateInput,
  type OrchestrateResult,
  type TaskProgress,
} from '../../services/novel-gen/orchestrate';
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
  /** 批量发起的期望并发（1-4，书架弹窗透传）：全局「意图」非任务属性——handler 应用到
   *  novelQueue.setDesiredParallel（最近一次设置生效，调高主动放行），不落盘任务文件 */
  parallel: z.number().int().min(1).max(4).optional(),
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

// ---------- 后台执行器（Task 3.3 runner 实装） ----------

/** 进度节流间隔（1s）：执行期增量高频上报只留最近一次落盘 */
const PROGRESS_THROTTLE_MS = 1000;
/** 强制落盘相位：saving 每章仅一次（章完成即刻可见，不参与节流） */
const FORCED_PHASES: ReadonlySet<TaskProgress['phase']> = new Set(['saving']);

function taskFileOf(id: string): string {
  return join(llmTasksDir(), `${id}.json`);
}

/**
 * 任务文件写队列（per-task 串行，M2 Task 3.3）：终态写 / 进度节流写 / cancel 置位 /
 * failed 兜底写全部「读磁盘合并 → 写」原子排队——并发 RMW 互相覆盖（丢 cancelRequested）
 * 的根治。单进程设计下队列即全量写方；排队各自合并磁盘最新态，字段保全由合并保证。
 */
const taskWriteQueues = new Map<string, Promise<unknown>>();

export function enqueueTaskWrite<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = taskWriteQueues.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn); // 前序失败不阻塞后继（各写方自带合并与容错）
  taskWriteQueues.set(id, next.then(() => undefined, () => undefined));
  return next;
}

/**
 * isCancelled：每次调用重读任务文件（文件缺失/损坏 → false——让链自然结束于终态写，
 * 不因文件瞬断误判取消）。
 */
/** 任务级总时长上限（每章 20 分钟 + 基础 5 分钟组装/润色余量）：超时视同取消——
 *  生产实证 30 分钟卡死案例（第 3 章 assembling 阶段上游挂住无进展且无超时保护）。
 *  已完成章保留（D6），任务终态标「生成超时」可重新发起。 */
export const CHAPTER_TASK_TIMEOUT_MS = 20 * 60 * 1000;
const TASK_TIMEOUT_BASE_MS = 5 * 60 * 1000;

function makeCancelChecker(id: string, deadline: number): () => boolean {
  const file = taskFileOf(id);
  let lastRead = 0;
  let cached = false;
  return () => {
    if (Date.now() > deadline) return true; // 超时即取消（时间条件优先，不再读盘）
    const now = Date.now();
    if (now - lastRead < 5000) return cached; // 5s 节流：段间/轮间检查不逐次打盘
    lastRead = now;
    try {
      cached = (JSON.parse(readFileSync(file, 'utf8')) as { cancelRequested?: boolean }).cancelRequested === true;
    } catch {
      cached = false;
    }
    return cached;
  };
}

/**
 * novel-chapter 后台执行（Task 3.3 实装）：
 * acquireNovelSlot → orchestrateNovelChapters（进度 1s 节流落盘 + 取消标志重读）→ 终态写
 * （done: resultMessages/resultMessageIds；failed: error 含失败原因，作品已删除区分——D6）。
 * finally releaseNovelSlot。终态/进度写一律合并磁盘最新态（...(disk ?? task) 打底），
 * 绝不回滚执行期间并发落盘的其他字段（典型：cancel 置位的 cancelRequested）。
 */
/**
 * 进度落盘节流器（2026-11-24 修复，用户实测「一章看起来写完了却不停止、字也不增」）：
 * - 相位切换立即写（此前所有相位都过节流，assembling 写入后 1s 内的 generating 上报被丢弃，
 *   整个生成期间界面一直显示「组装中、0 字」，下一章生成期间残留上一章正文）；
 * - saving 每章仅一次，不节流；
 * - 同相位的正文增量按 PROGRESS_THROTTLE_MS 节流，窗口内的最后一次上报在窗口结束时补写
 *   （否则上游停在两帧之间时，最后到达的正文永远写不进去）；
 * - 全部经 enqueueTaskWrite 串行——进度写与 cancel 置位/终态写互不覆盖。
 */
function makeProgressSink(
  taskId: string,
  fallback: TaskFile,
  file: string,
): { onProgress: (p: TaskProgress) => void; dispose: () => void } {
  let lastWrite = 0;
  let lastPhase: TaskProgress['phase'] | null = null;
  let pending: TaskProgress | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = (p: TaskProgress): void => {
    lastWrite = Date.now();
    lastPhase = p.phase;
    void enqueueTaskWrite(taskId, async () => {
      const disk = await readJson<TaskFile>(file).catch(() => null);
      await writeJsonAtomicRetry(file, {
        ...(disk ?? fallback),
        status: 'running',
        progress: { ...p, updatedAt: Date.now() },
      } satisfies TaskFile);
    }).catch(() => undefined); // 进度落盘失败不阻塞生成链（下次上报自然重试）
  };
  const onProgress = (p: TaskProgress): void => {
    const sinceLast = Date.now() - lastWrite;
    if (p.phase !== lastPhase || FORCED_PHASES.has(p.phase) || sinceLast >= PROGRESS_THROTTLE_MS) {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      write(p);
      return;
    }
    pending = p;
    timer ??= setTimeout(
      () => {
        timer = null;
        if (pending) {
          const last = pending;
          pending = null;
          write(last);
        }
      },
      PROGRESS_THROTTLE_MS - sinceLast,
    );
  };
  const dispose = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return { onProgress, dispose };
}

export async function executeNovelChapter(task: TaskFile): Promise<void> {
  if (!task.workId) throw new Error('novel-chapter 任务缺少 workId');
  await acquireNovelSlot(); // 全局并发编排器（D7）：默认并发 2（NOVEL_GEN_PARALLEL 可调），FIFO 排队
  const t0 = Date.now();
  const file = taskFileOf(task.id);
  try {
    const sink = makeProgressSink(task.id, task, file);
    const input: OrchestrateInput = {
      workId: task.workId,
      prefs: task.prefs ?? { source: 'openai', model: '' },
      mode: task.mode ?? 'chapter',
      directive: task.directive ?? '',
      chapters: task.chapters ?? 1,
      outline: task.outline ?? false,
      ...(task.targetId ? { targetId: task.targetId } : {}),
      ...(task.partial ? { partial: task.partial } : {}),
      isCancelled: makeCancelChecker(task.id, t0 + TASK_TIMEOUT_BASE_MS + CHAPTER_TASK_TIMEOUT_MS * (task.chapters ?? 1)),
      onProgress: sink.onProgress,
    };
    let result: OrchestrateResult;
    try {
      result = await orchestrateNovelChapters(input);
    } finally {
      sink.dispose(); // 任务结束：不再补写窗口内的进度（终态写会清掉 progress）
    }
    await enqueueTaskWrite(task.id, async () => {
      const disk = await readJson<TaskFile>(file).catch(() => null);
      await writeJsonAtomicRetry(file, {
        ...(disk ?? task),
        status: result.failed ? 'failed' : 'done',
        ...(result.failed ? { error: result.failed } : {}),
        // 部分完成（取消/超时停链）：warning 说明如实透出（书架卡片/书页可展示「已完成 N/M 章」）
        ...(result.stopped && result.done < (task.chapters ?? 1)
          ? { warning: `已停止：完成 ${result.done}/${task.chapters ?? 1} 章后达到时长上限或手动取消——已完成章节已保留，可重新发起续写` }
          : {}),
        elapsedMs: Date.now() - t0,
        resultMessages: result.done, // 终态：本次任务入库章数（取消/部分完成如实计数——D6）
        resultMessageIds: result.messageIds, // 终态：入库消息 id 列表（客户端同步本地视图唯一依据）
        progress: undefined, // 终态清执行期增量
        messages: undefined,
        params: undefined,
      } satisfies TaskFile);
    });
  } finally {
    releaseNovelSlot();
  }
}

/** 编排入参类型公开面（测试/上层复用） */
export type { OrchestrateInput };
