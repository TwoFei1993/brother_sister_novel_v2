/**
 * LLM 后台任务路由（用户需求：切出 App 后生成继续，回来取结果）
 *
 * POST /llm/tasks          提交任务（立即 202 返回 taskId，server 后台执行）
 *                          kind 缺省/'llm' = 单次 LLM 调用；'novel-chapter' = 整书章节生成（M2）
 * GET  /llm/tasks/active   进行中任务列表（novel-chapter 恢复现场用；须注册在 /:id 之前）
 * GET  /llm/tasks/:id      查询：running（执行中，?since=N 增量切片）/ done（含结果文本）
 *                          / failed（含错误）/ lost（server 重启丢失）/ expired（30 分钟未取）
 * POST /llm/tasks/:id/cancel  取消：pending/running 置 cancelRequested 标志（段间/章间生效），
 *                          终态 ok:false，文件缺失 404 lost
 *
 * 生命周期（纯文件状态机——无内存 Map，杜绝跨实例不一致）：
 * - 提交：novel-chapter 先做同书互斥扫描（pending/running 含取消中 → 409 GEN_BUSY）；
 *   同步落盘 status:'pending'（提交参数一并落盘供后台执行读取）→ 后台执行更新终态
 * - 后台执行：kind 分流——llm 走 execute（stream:true 聚合全文，三级稳定性防线）；
 *   novel-chapter 走 executeNovelChapter（Task 3.3 实装：并发编排器 + orchestrateNovelChapters
 *   全链编排 + 进度 1s 节流落盘）
 * - 查询：pending/running → running（带 ?since=N 时返回 progress 增量切片）；
 *   done → 返回文本（永久保留 draft 幂等 GET，附 resultMessages/resultMessageIds）；
 *   failed → 返回错误；文件缺失/损坏 → lost（前端提示重试）
 * - 重启：main.ts 启动时清扫滞留 pending/running → failed（sweepInterruptedTasks），
 *   否则永无执行者的任务会永久占用同书互斥
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';

import { zodBody } from '../../middleware/validate';
import { readJson, writeJsonAtomic, writeJsonAtomicRetry } from '../../storage/store';
import { setDesiredParallel } from '../../services/novelQueue';
import { wrap } from '../works/works';
import { execute } from './tasksExecute';
import {
  enqueueTaskWrite,
  executeNovelChapter,
  llmTasksDir,
  novelChapterSchema,
  scanActiveTasks,
  sourceSchema,
} from './tasksNovel';
import type { TaskProgress } from '../../services/novel-gen/orchestrate';

// 执行期增量进度类型由编排层定义（server 端 novel-gen 产出的负载形状）
export type { TaskProgress };

function taskFile(id: string): string {
  return join(llmTasksDir(), `${id}.json`);
}

/** 旧客户端单次 LLM 调用提交体（原样保留——旧请求零影响）；kind 缺省即 'llm' */
const llmTaskSchema = z.object({
  kind: z.literal('llm').optional(), // discriminated union 判别字段（旧请求无此键 → undefined）
  source: sourceSchema,
  model: z.string().min(1),
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() })).min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  thinking: z.boolean().optional(),
  label: z.string().max(30).optional(),
});

const createSchema = z.union([llmTaskSchema, novelChapterSchema]);

/**
 * 任务文件（纯文件状态机的持久化形状；全部向后兼容——旧字段不动，新字段全 optional）。
 * novel-chapter 提交参数（prefs/mode/directive/...）落盘供后台执行与断点恢复读取。
 */
export interface TaskFile {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  text?: string;
  error?: string;
  label?: string;
  createdAt: number;
  elapsedMs?: number;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  params?: Record<string, unknown>;
  thinking?: boolean;
  // ---- novel-chapter 专属（kind 缺省 'llm' 的旧任务文件无这些字段）----
  kind?: 'llm' | 'novel-chapter';
  workId?: string;
  prefs?: z.infer<typeof novelChapterSchema>['prefs'];
  mode?: z.infer<typeof novelChapterSchema>['mode'];
  directive?: string;
  chapters?: number;
  outline?: boolean;
  targetId?: string;
  partial?: string;
  cancelRequested?: boolean; // 取消标志：段间/章间生效（当前段跑完即停）
  progress?: TaskProgress; // 执行期增量；终态置 undefined
  resultMessages?: number; // 终态：本次任务入库章数（done 时有）
  resultMessageIds?: string[]; // 终态：入库消息 id 列表（客户端同步本地视图的唯一依据）
}

/** :id 路径段格式校验（defense-in-depth：randomUUID 产物必匹配，其余一律按 lost 404，不落盘读） */
const TASK_ID_RE = /^[0-9a-f-]{36}$/i;

const LOST_PAYLOAD = { status: 'lost', error: '任务不存在或服务已重启——请重新提交' } as const;

/** 读任务文件：不存在 → null（lost 语义）；存在但损坏 → 告警后同样按 null（区分场景不 500） */
async function readTaskFile(id: string): Promise<TaskFile | null> {
  try {
    return await readJson<TaskFile>(taskFile(id));
  } catch (err) {
    console.warn('[llm-tasks] 任务文件损坏，按缺失处理：', taskFile(id), err);
    return null;
  }
}

/**
 * 启动清扫（main.ts 调用；单进程设计下重启后 pending/running 必无执行者，零误判）：
 * 统一落盘 failed——否则滞留任务会永久占用同书互斥（409 卡死）。返回清扫数。
 */
export async function sweepInterruptedTasks(): Promise<number> {
  const stale = await scanActiveTasks(llmTasksDir());
  for (const t of stale) {
    // 启动期无并发，直接以扫描所得为准落终态（仍走 retry 落盘防 Windows EPERM）
    await writeJsonAtomicRetry(taskFile(t.id), {
      ...t,
      status: 'failed',
      error: '服务重启中断，请重新提交',
      messages: undefined,
      params: undefined,
      progress: undefined,
    }).catch(() => undefined);
  }
  return stale.length;
}

export const llmTasksRouter = Router();

// 相对路径（挂载点 llmRouter.use('/llm/tasks', …) 已剥前缀）——
// 此前写成完整路径 '/llm/tasks' 造成双重前缀，实际匹配 /api/llm/tasks/llm/tasks，带登录态必 404「接口不存在」
llmTasksRouter.post(
  '/',
  zodBody(createSchema),
  wrap(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    if (body.kind === 'novel-chapter') {
      // 同书互斥（权威层，先查后写避免自见）：pending/running 含取消中任务一律 409
      // ——取消最多等当前段跑完，期间重提交会双任务竞态，安全第一
      const busy = await scanActiveTasks(
        llmTasksDir(),
        (t) => t.kind === 'novel-chapter' && t.workId === body.workId,
      );
      if (busy.length > 0) {
        res.status(409).json({ code: 'GEN_BUSY', message: '该书已有生成任务进行中' });
        return;
      }
      // 批量并发意图（Chunk 6）：带 parallel 时更新全局期望上限（最近一次设置生效，
      // 调高主动放行排队任务）——互斥检查后才应用：被 409 拒绝的提交不改全局并发
      if (body.parallel !== undefined) setDesiredParallel(body.parallel);
    }
    const id = randomUUID();
    const task: TaskFile =
      body.kind === 'novel-chapter'
        ? {
            id,
            status: 'pending',
            createdAt: Date.now(),
            kind: 'novel-chapter',
            workId: body.workId,
            prefs: body.prefs,
            mode: body.mode,
            directive: body.directive,
            chapters: body.chapters,
            outline: body.outline,
            targetId: body.targetId,
            partial: body.partial,
          }
        : {
            id,
            status: 'pending',
            text: undefined,
            error: undefined,
            label: body.label,
            createdAt: Date.now(),
            messages: body.messages,
            params: body.params,
            thinking: body.thinking,
          };
    // 同步先落盘 pending（查询立即可见 running 语义）→ 后台执行更新终态
    await writeJsonAtomic(taskFile(id), task);
    const run =
      body.kind === 'novel-chapter' ? executeNovelChapter(task) : execute(task, body.source, body.model);
    void run.catch(async (err) => {
      // 合并磁盘最新态再落 failed（与 execute 终态写同一硬约束）：不回滚执行期间
      // 并发落盘的其他字段（如 cancelRequested）；progress 同步清（终态无执行期增量）。
      // 写经 enqueueTaskWrite 串行（per-task RMW 互不覆盖）
      await enqueueTaskWrite(id, async () => {
        const disk = await readTaskFile(id);
        await writeJsonAtomicRetry(taskFile(id), {
          ...(disk ?? task),
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          messages: undefined,
          params: undefined,
          progress: undefined,
        } satisfies TaskFile);
      }).catch(() => undefined);
    });
    res.status(202).json({ taskId: id });
  }),
);

// GET /active 必须注册在 GET /:id 之前（Express 按注册顺序匹配，否则 active 被当 id 吞掉）
llmTasksRouter.get('/active', wrap(async (_req, res) => {
  const tasks = await scanActiveTasks(llmTasksDir());
  res.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      kind: t.kind ?? 'llm',
      workId: t.workId,
      label: t.label,
      progressLen: t.progress?.text?.length ?? 0, // 非空安全：损坏文件 progress.text 缺失按 0
      done: t.progress?.done ?? 0,
      chapterTotal: t.progress?.chapterTotal ?? 0,
      phase: t.progress?.phase,
      createdAt: t.createdAt,
    })),
  });
}));

llmTasksRouter.post('/:id/cancel', wrap(async (req, res) => {
  const id = req.params.id;
  if (!TASK_ID_RE.test(id)) {
    res.status(404).json(LOST_PAYLOAD);
    return;
  }
  // 有界重读（读→判终态→写前再读一次→写）：把「读到 pending/running」与「落标志」之间的
  // 窗口压到单次 fs 操作间隙——执行器终态写恰好落在窗口内时，重读即见终态并返回 ok:false，
  // 绝不把已终态文件覆盖回 pending（配套：终态写侧合并磁盘最新态，见 tasksExecute.execute）
  let task = await readTaskFile(id);
  if (!task) {
    res.status(404).json(LOST_PAYLOAD);
    return;
  }
  if (task.status !== 'done' && task.status !== 'failed') {
    const fresh = (await readTaskFile(id)) ?? task;
    task = fresh;
  }
  if (task.status === 'done' || task.status === 'failed') {
    res.json({ ok: false });
    return;
  }
  // 只置标志不改状态：取消在段间/章间生效（当前段跑完即停），执行器读盘感知。
  // 写经 enqueueTaskWrite 串行：不覆盖执行器并发落盘的 progress，也不被其覆盖
  await enqueueTaskWrite(id, () => writeJsonAtomicRetry(taskFile(id), { ...task, cancelRequested: true }));
  res.json({ ok: true });
}));

/** ?since=N 的合法值：非负整数（query 到手是 string；非法忽略走无 since 分支） */
function parseSince(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

llmTasksRouter.get('/:id', wrap(async (req, res) => {
  const id = req.params.id;
  if (!TASK_ID_RE.test(id)) {
    res.status(404).json(LOST_PAYLOAD);
    return;
  }
  const task = await readTaskFile(id);
  if (!task) {
    res.status(404).json(LOST_PAYLOAD);
    return;
  }
  if (task.status === 'done' || task.status === 'failed') {
    // 结果永久保留为 draft（用户要求：不设 30 分钟过期）——前端取走后 slot 清除不重复回填，
    // server 侧文件留存可随时复查/重取（幂等 GET）；resultMessages/resultMessageIds 有则带
    res.json({
      status: task.status,
      text: task.text,
      error: task.error,
      label: task.label,
      resultMessages: task.resultMessages,
      resultMessageIds: task.resultMessageIds,
    });
    return;
  }
  const since = parseSince(req.query.since);
  if (since !== null) {
    // 增量切片协议（novel-chapter 轮询）：progressText=当前章全文 slice(since)；无 progress 视为尚未开始
    const p = task.progress;
    res.json({
      status: 'running',
      label: task.label,
      progressLen: p?.text?.length ?? 0, // 非空安全：损坏文件 progress.text 缺失按 0
      progressText: typeof p?.text === 'string' ? p.text.slice(since) : '',
      done: p?.done ?? 0,
      chapterTotal: p?.chapterTotal ?? 0,
      phase: p?.phase ?? 'assembling',
      chapterIndex: p?.chapterIndex ?? 0,
    });
    return;
  }
  res.json({ status: 'running' });
}));
