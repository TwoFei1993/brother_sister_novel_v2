/**
 * 三级稳定性防线（用户要求 2026-11-11：上游过载不再全停）：
 * ① 同通道瞬态重试：指数退避覆盖分钟级过载窗口
 * ② 预算协商：空输出 → max_tokens 加倍（cap 64000）
 * ③ 灾备通道：主通道重试耗尽 → 自动切换 secrets 中已配置的其他 LLM 通道（内置各通道默认快模型）
 *
 * 自 routes/llm/tasksExecute.ts 下沉至服务层（M2 Task 3.2）：novel 章节编排与旧 llm
 * 任务共用同一实现（单一事实源），且消除 services→routes 的反向依赖。
 */
import { join } from 'node:path';

import { dataDir } from '../../routes/core/paths';
import { readJson } from '../../storage/store';

import { LlmError, runGenerate, type GenerateInput } from './index';

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
    (await readJson<Record<string, { apiKey?: string }>>(join(dataDir(), 'secrets.json')).catch(() => ({}))) ?? {};
  const all: Array<'openai' | 'claude' | 'gemini'> = ['gemini', 'openai', 'claude'];
  return all.filter((c) => c !== exclude && Boolean(s?.[c]?.apiKey));
}

/** 聚合一次 runGenerate 流式调用的全文/思考流/结束原因（空返回不抛错，由防线决定重试/换通道）。
 *  onText：每收到正文增量回调一次「本轮累计正文」（供任务进度流式上报——界面可见字数增长） */
async function collectStream(
  opts: GenerateInput,
  onText?: (textSoFar: string) => void,
): Promise<{ text: string; thinking: string; finish: string | null }> {
  let text = '';
  let thinking = '';
  let finish: string | null = null;
  for await (const ev of runGenerate(opts)) {
    if (ev.kind === 'error') throw new LlmError(ev.code, ev.message);
    if (ev.kind === 'text') {
      text += ev.text;
      if (ev.thinking) thinking += ev.thinking;
      if (ev.finish) finish = ev.finish;
      if (onText && ev.text) onText(text);
    }
  }
  return { text, thinking, finish };
}

export interface DefendedResult {
  /** 聚合全文（防线耗尽仍无产出时空串） */
  text: string;
  /** 思考流聚合（D4 thinking 帧） */
  thinking: string;
  /** 上游结束原因（末次声明值；截断续写判据） */
  finish: string | null;
  /** 末次错误消息（有产出时为空串） */
  lastErr: string;
}

/**
 * 带三级防线的流式生成聚合：
 * ① 同通道瞬态重试（指数退避，LLM_TASK_RETRY_DELAYS_MS 可注入）
 * ② 空输出预算加倍（max_tokens 起 maxTokens，cap 64000）
 * ③ 灾备通道（主通道耗尽仍无产出 → 其他已配置通道 + 内置快模型）
 * 必须流式：长输入/长生成任务靠增量 chunk 重置上游空闲超时（llm 双超时设计）。
 */
export async function collectWithDefense(input: {
  source: 'openai' | 'claude' | 'gemini';
  model: string;
  messages: GenerateInput['messages'];
  params?: Record<string, unknown>;
  /** 首轮 max_tokens（调用方按语义定起始值：旧 llm 任务 thinking 时 32000 下限，novel 段级预算） */
  maxTokens: number;
  /** 流式回调：每轮以空串起始（重试/预算协商/灾备换通道时先清空），之后为本轮累计正文 */
  onText?: (textSoFar: string) => void;
}): Promise<DefendedResult> {
  const baseParams = input.params ?? {};
  let text = '';
  let thinking = '';
  let finish: string | null = null;
  let lastErr = '';
  let maxTokens = input.maxTokens;
  const delays = retryDelaysMs();
  for (let round = 0; round <= delays.length; round += 1) {
    try {
      input.onText?.(''); // 新一轮从头累计：界面不残留上一轮的片段
      const r = await collectStream(
        {
          source: input.source,
          model: input.model,
          messages: input.messages,
          params: { ...baseParams, max_tokens: maxTokens },
          stream: true, // 非流式下上游生成全程无字节返回，长输入任务必撞 120s 空闲超时
        },
        input.onText,
      );
      text = r.text;
      thinking = r.thinking;
      finish = r.finish;
      console.log('[llm-defense] round', round, 'textLen', text.length, 'err', lastErr);
      if (text.trim()) return { text, thinking, finish, lastErr: '' };
      // 空输出：加倍预算下一轮
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      // 瞬态上游故障（LLM_NET=5xx/网络、LLM_QUOTA=429 限流）：指数退避后同参数重试
      // 非瞬态（LLM_AUTH 密钥 / LLM_REJECTED 内容审核）：跳出走灾备通道
      const isTransient = err instanceof LlmError && (err.code === 'LLM_NET' || err.code === 'LLM_QUOTA');
      if (!isTransient) break;
      const delay = delays[Math.min(round, delays.length - 1)];
      console.log(`[llm-defense] 瞬态失败（${lastErr.slice(0, 80)}），${delay / 1000}s 后重试`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    maxTokens = Math.min(maxTokens * 2, 64000);
  }

  // ③ 灾备通道：主通道耗尽（含瞬态重试）仍无产出 → 切换其他已配置通道（内置该通道默认快模型）
  if (!text.trim()) {
    const fallbacks = await configuredChannels(input.source);
    for (const fbSource of fallbacks) {
      const fbModel = FALLBACK_MODELS[fbSource];
      console.log(`[llm-defense] 主通道无产出 → 灾备通道 ${fbSource}/${fbModel}`);
      try {
        input.onText?.('');
        const r = await collectStream(
          {
            source: fbSource,
            model: fbModel,
            messages: input.messages,
            params: { ...baseParams, max_tokens: Math.max(Number(baseParams.max_tokens ?? 8192), 32000) },
            stream: true,
          },
          input.onText,
        );
        if (r.text.trim()) return { text: r.text, thinking: r.thinking, finish: r.finish, lastErr: '' };
        lastErr = lastErr || '灾备通道无产出';
      } catch (fbErr) {
        lastErr = fbErr instanceof Error ? fbErr.message : String(fbErr);
      }
    }
  }
  return { text, thinking, finish, lastErr };
}
