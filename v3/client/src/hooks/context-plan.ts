/**
 * 上下文规划层（纯内核已下沉 shared/engine/prompt/context-plan）
 *
 * 本文件保留 summarizeDropped 实现——内部走 apiFetch 调 LLM（client IO），
 * 其余（EMPTY_PRESET/SCAN_SETTINGS/planContext/守卫/兜底预设/类型）全部
 * re-export 自 shared；generation-pipeline.ts 的 re-export 面保持不变。
 */
export {
  EMPTY_PRESET,
  SCAN_SETTINGS,
  buildChatMainPrompt,
  buildFallbackPreset,
  novelGuardPlan,
  planContext,
  withNovelOutputGuard,
} from '@shared/engine/prompt/context-plan';
export type {
  AssembleTail,
  FittedPrompt,
  GenerateMessage,
  SummarizeDropped,
  SummarizePrefs,
} from '@shared/engine/prompt/context-plan';

import type { SummarizeDropped } from '@shared/engine/prompt/context-plan';

import { apiFetch } from '../api/client';
import { buildSummarizePrompt } from '../engine/prompt/novel/memory';

/** 滚动摘要（防失忆）：把被预算切出的最旧消息压缩为摘要文本；失败返回 null（生成不阻塞）。
 *  签名取自 shared 的 SummarizeDropped 类型（prefs 为结构最小类型，LlmPrefs 调用方天然兼容）。 */
export const summarizeDropped: SummarizeDropped = async (prefs, prevSummary, texts) => {
  if (texts.length === 0) return null;
  const { system, user } = buildSummarizePrompt(prevSummary ?? '', texts);
  try {
    const out = (await apiFetch('/api/llm/generate', {
      method: 'POST',
      body: JSON.stringify({
        source: prefs.source,
        model: prefs.model || undefined,
        stream: false,
        params: { max_tokens: 700, temperature: 0.3 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })) as { text?: string };
    const text = out.text?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
};
