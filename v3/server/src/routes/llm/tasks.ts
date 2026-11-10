/**
 * LLM 后台任务路由（用户需求：切出 App 后生成继续，回来取结果）
 *
 * POST /llm/tasks        提交任务（立即 202 返回 taskId，server 后台调上游执行）
 * GET  /llm/tasks/:id    查询：running（执行中）/ done（含结果文本）/ failed（含错误）
 *                        / lost（server 重启丢失）/ expired（30 分钟未取）
 *
 * 生命周期（纯文件状态机——无内存 Map，杜绝跨实例不一致）：
 * - 提交：同步落盘 status:'pending'（messages/params 一并落盘供后台执行读取）
 * - 后台执行：读回任务 → runGenerate（stream:false 聚合全文；空输出自动加倍预算 ≤4 轮 cap 64000）
 *   → 更新同一文件 status:'done'|'failed'（messages 置空，隐私不落盘二份）
 * - 查询：pending/running → running；done → 返回文本并取走即焚（删文件）；
 *   failed → 返回错误并删；文件缺失 → lost（server 重启丢失，前端提示重试）
 * - 过期：done/failed 落盘 30 分钟未取 → 410 expired
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';

import { LlmError, runGenerate } from '../../services/llm';
import { zodBody } from '../../middleware/validate';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { dataDir } from '../core/paths';
import { wrap } from '../works/works';

const TASKS_DIR = join(dataDir(), 'llm-tasks');

/** 与 routes/llm.ts 同源（内联避免循环依赖） */
const sourceSchema = z.enum(['openai', 'claude', 'gemini']);

const createSchema = z.object({
  source: sourceSchema,
  model: z.string().min(1),
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() })).min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  thinking: z.boolean().optional(),
  label: z.string().max(30).optional(),
});

/** 任务文件（pending 执行期含 messages；终态置空 messages 隐私不落盘二份） */
interface TaskFile {
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
}

function taskFile(id: string): string {
  return join(TASKS_DIR, `${id}.json`);
}


/** writeJsonAtomic 的 Windows 加固：EPERM（读者占用+rename 撞车）重试 3 次 */
async function writeJsonAtomicRetry(file: string, data: unknown): Promise<void> {
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

/** 预算协商执行（server 端：空输出 → max_tokens 加倍，最多 4 轮 cap 64000） */
async function execute(task: TaskFile, source: 'openai' | 'claude' | 'gemini', model: string): Promise<void> {
  const t0 = Date.now();
  const messages = task.messages ?? [];
  const baseParams = task.params ?? {};
  let text = '';
  let lastErr = '';
  let maxTokens = Math.max(Number(baseParams.max_tokens ?? 8192), task.thinking === false ? 8192 : 32000);
  for (let round = 0; round < 4; round += 1) {
    try {
      const events = runGenerate({
        source,
        model,
        messages,
        params: { ...baseParams, max_tokens: maxTokens, thinking: task.thinking },
        stream: false,
      });
      for await (const ev of events) {
        if (ev.kind === 'error') throw new LlmError(ev.code as never, ev.message);
        if (ev.kind === 'text') text += ev.text;
      }
      console.log('[execute] round', round, 'textLen', text.length, 'err', lastErr);
      if (text.trim()) break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      break; // 上游错误（鉴权/限流/超时）不重试——落盘 failed
    }
    maxTokens = Math.min(maxTokens * 2, 64000);
  }
  const next: TaskFile = {
    ...task,
    status: text.trim() ? 'done' : 'failed',
    text: text.trim() || undefined,
    error: text.trim() ? undefined : lastErr || '模型无输出（预算加倍后仍空）',
    elapsedMs: Date.now() - t0,
    messages: undefined,
    params: undefined,
  };
  await writeJsonAtomicRetry(taskFile(task.id), next);
}

export const llmTasksRouter = Router();

llmTasksRouter.post(
  '/llm/tasks',
  zodBody(createSchema),
  wrap(async (req, res) => {
    const { source, model, messages, params, thinking, label } = req.body as z.infer<typeof createSchema>;
    const id = randomUUID();
    const task: TaskFile = {
      id,
      status: 'pending',
      text: undefined,
      error: undefined,
      label,
      createdAt: Date.now(),
      messages,
      params,
      thinking,
    };
    // 同步先落盘 pending（查询立即可见 running 语义）→ 后台执行更新终态
    await writeJsonAtomic(taskFile(id), task);
    void execute(task, source, model).catch(async (err) => {
      await writeJsonAtomicRetry(taskFile(id), {
        ...task,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        messages: undefined,
        params: undefined,
      } satisfies TaskFile).catch(() => undefined);
    });
    res.status(202).json({ taskId: id });
  }),
);

llmTasksRouter.get('/llm/tasks/:id', wrap(async (req, res) => {
  const id = req.params.id;
  const task = await readJson<TaskFile>(taskFile(id)).catch(() => null);
  if (!task) {
    res.status(404).json({ status: 'lost', error: '任务不存在或服务已重启——请重新提交' });
    return;
  }
  if (task.status === 'done' || task.status === 'failed') {
    // 结果永久保留为 draft（用户要求：不设 30 分钟过期）——前端取走后 slot 清除不重复回填，
    // server 侧文件留存可随时复查/重取（幂等 GET）
    res.json({ status: task.status, text: task.text, error: task.error, label: task.label });
    return;
  }
  res.json({ status: 'running' });
}));
