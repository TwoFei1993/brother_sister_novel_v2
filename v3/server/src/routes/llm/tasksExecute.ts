/**
 * LLM 后台任务执行器（kind='llm' 单次调用；与路由层分离——tasks.ts 只管协议与状态机）
 *
 * 稳定性三级防线（用户要求 2026-11-11：上游过载不再全停）：
 * ① 同通道瞬态重试：指数退避覆盖分钟级过载窗口
 * ② 预算协商：空输出 → max_tokens 加倍（cap 64000）
 * ③ 灾备通道：主通道重试耗尽 → 自动切换 secrets 中已配置的其他 LLM 通道（内置各通道默认快模型）
 */
import { join } from 'node:path';

import { LlmError, runGenerate } from '../../services/llm';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { dataDir } from '../core/paths';
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
  const s: Record<string, { apiKey?: string }> =
    (await readJson<Record<string, { apiKey?: string }>>(join(dataDir(), 'secrets.json')).catch(
      () => ({}),
    )) ?? {};
  const all: Array<'openai' | 'claude' | 'gemini'> = ['gemini', 'openai', 'claude'];
  return all.filter((c) => c !== exclude && Boolean(s?.[c]?.apiKey));
}

/** 聚合一次 runGenerate 流式调用的全文（空返回不抛错，由调用方决定重试/换通道） */
async function collectText(opts: Parameters<typeof runGenerate>[0]): Promise<string> {
  let text = '';
  const events = runGenerate(opts);
  for await (const ev of events) {
    if (ev.kind === 'error') throw new LlmError(ev.code as never, ev.message);
    if (ev.kind === 'text') text += ev.text;
  }
  return text;
}

export async function execute(task: TaskFile, source: 'openai' | 'claude' | 'gemini', model: string): Promise<void> {
  const t0 = Date.now();
  const messages = task.messages ?? [];
  const baseParams = task.params ?? {};
  let text = '';
  let lastErr = '';
  let maxTokens = Math.max(Number(baseParams.max_tokens ?? 8192), task.thinking === false ? 8192 : 32000);
  const delays = retryDelaysMs();
  for (let round = 0; round <= delays.length; round += 1) {
    try {
      text = await collectText({
        source,
        model,
        messages,
        params: { ...baseParams, max_tokens: maxTokens, thinking: task.thinking },
        // 必须流式：非流式下上游生成全程无字节返回，长输入任务（整集拆解等）必撞 120s 空闲超时；
        // 流式下增量 chunk 持续重置空闲计时（llm.ts 双超时设计正是为此）
        stream: true,
      });
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
        text = await collectText({
          source: fbSource,
          model: fbModel,
          messages,
          params: { ...baseParams, max_tokens: Math.max(Number(baseParams.max_tokens ?? 8192), 32000), thinking: task.thinking },
          stream: true,
        });
        if (text.trim()) {
          lastErr = '';
          break;
        }
      } catch (fbErr) {
        lastErr = fbErr instanceof Error ? fbErr.message : String(fbErr);
      }
    }
  }

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
