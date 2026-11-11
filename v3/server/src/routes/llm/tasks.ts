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

/** 瞬态错误退避序列：覆盖分钟级上游过载窗口（实测 MiniMax 偶发 529/500 持续数分钟）；测试可经 env 注入快速值（每次调用读取） */
function retryDelaysMs(): number[] {
  return (process.env.LLM_TASK_RETRY_DELAYS_MS ?? '5000,15000,45000,90000,90000')
    .split(',')
    .map((n) => Number(n.trim()) || 5000);
}

/** 灾备通道默认模型（主通道持续过载时自动切换；用户未配密钥的通道自动跳过） */
const FALLBACK_MODELS: Record<'openai' | 'claude' | 'gemini', string> = {
  claude: 'MiniMax-M3.1-Flash',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
};

/** secrets.json 中已配置 apiKey 的 LLM 通道（claude=MiniMax 端点 / openai / gemini） */
async function configuredChannels(exclude: string): Promise<Array<'openai' | 'claude' | 'gemini'>> {
  const s: Record<string, { apiKey?: string }> = await readJson<
    Record<string, { apiKey?: string }>
  >(join(dataDir(), 'secrets.json')).catch(() => ({}));
  const all: Array<'openai' | 'claude' | 'gemini'> = ['gemini', 'openai', 'claude'];
  return all.filter((c) => c !== exclude && Boolean(s?.[c]?.apiKey));
}

/**
 * 后台任务执行（稳定性三级防线，用户要求 2026-11-11：上游过载不再全停）：
 * ① 同通道瞬态重试：指数退避覆盖分钟级过载窗口
 * ② 预算协商：空输出 → max_tokens 加倍（cap 64000）
 * ③ 灾备通道：主通道重试耗尽 → 自动切换 secrets 中已配置的其他 LLM 通道（内置各通道默认快模型）
 */
async function execute(task: TaskFile, source: 'openai' | 'claude' | 'gemini', model: string): Promise<void> {
  const t0 = Date.now();
  const messages = task.messages ?? [];
  const baseParams = task.params ?? {};
  let text = '';
  let lastErr = '';
  let maxTokens = Math.max(Number(baseParams.max_tokens ?? 8192), task.thinking === false ? 8192 : 32000);
  const delays = retryDelaysMs();
  for (let round = 0; round <= delays.length; round += 1) {
    try {
      const events = runGenerate({
        source,
        model,
        messages,
        params: { ...baseParams, max_tokens: maxTokens, thinking: task.thinking },
        // 必须流式：非流式下上游生成全程无字节返回，长输入任务（整集拆解等）必撞 120s 空闲超时；
        // 流式下增量 chunk 持续重置空闲计时（llm.ts 双超时设计正是为此）
        stream: true,
      });
      for await (const ev of events) {
        if (ev.kind === 'error') throw new LlmError(ev.code as never, ev.message);
        if (ev.kind === 'text') text += ev.text;
      }
      console.log('[execute] round', round, 'textLen', text.length, 'err', lastErr);
      if (text.trim()) break;
      // 空输出：加倍预算下一轮
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      // 瞬态上游故障（LLM_NET=5xx/网络、LLM_QUOTA=429 限流）：指数退避后同参数重试
      // 非瞬态（LLM_AUTH 密钥 / LLM_REJECTED 内容审核）：直接落盘 failed
      const isTransient =
        err instanceof LlmError && (err.code === 'LLM_NET' || err.code === 'LLM_QUOTA');
      if (!isTransient) break;
      const delay = delays[Math.min(round, delays.length - 1)];
      console.log(`[execute] 瞬态失败（${lastErr.slice(0, 80)}），${delay / 1000}s 后重试`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    maxTokens = Math.min(maxTokens * 2, 64000);
  }

  // ③ 灾备通道：主通道耗尽（含瞬态重试）仍无产出 → 切换其他已配置通道（内置该通道默认快模型）
  if (!text.trim()) {
    const fallbacks = await configuredChannels(source);
    for (const fbSource of fallbacks) {
      const fbModel = FALLBACK_MODELS[fbSource];
      console.log(`[execute] 主通道无产出 → 灾备通道 ${fbSource}/${fbModel}`);
      try {
        const events = runGenerate({
          source: fbSource,
          model: fbModel,
          messages,
          params: { ...baseParams, max_tokens: Math.max(Number(baseParams.max_tokens ?? 8192), 32000), thinking: task.thinking },
          stream: true,
        });
        for await (const ev of events) {
          if (ev.kind === 'error') throw new LlmError(ev.code as never, ev.message);
          if (ev.kind === 'text') text += ev.text;
        }
        if (text.trim()) {
          lastErr = '';
          break;
        }
      } catch (fbErr) {
        lastErr = fbErr instanceof Error ? fbErr.message : String(fbErr);
      }
    }
  }

  const next: TaskFile = {
    ...task,
    status: text.trim() ? 'done' : 'failed',
    text: text.trim() || undefined,
    error: text.trim() ? undefined : `${lastErr || '模型无输出（预算加倍后仍空）'}（主通道+灾备通道均无产出）`,
    elapsedMs: Date.now() - t0,
    messages: undefined,
    params: undefined,
  };
  await writeJsonAtomicRetry(taskFile(task.id), next);
}

export const llmTasksRouter = Router();

// 相对路径（挂载点 llmRouter.use('/llm/tasks', …) 已剥前缀）——
// 此前写成完整路径 '/llm/tasks' 造成双重前缀，实际匹配 /api/llm/tasks/llm/tasks，带登录态必 404「接口不存在」
llmTasksRouter.post(
  '/',
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

llmTasksRouter.get('/:id', wrap(async (req, res) => {
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
