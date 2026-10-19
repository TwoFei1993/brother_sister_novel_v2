/**
 * chat 生成非 hook 层（useChatGenerate 的管线层，对位 hooks/generation-pipeline.ts）
 *
 * 与 novel 管线的关系（review #7 去重后）：
 * - 直接复用 generation-pipeline：loadAssembleAssets / persistMessage / persistVariables /
 *   appendSwipe / scanAndAssemble（末轮注入经 AssembleTail 参数化，chat 走 userMessage 通道，
 *   scanAndAssembleChat 仅作语义命名的薄调用）/ FittedPrompt / AssembleAssets / PendingVars
 * - 本文件只保留 chat 语义差异：buildChatMacroEnv（char=激活角色、user=「用户」）、
 *   buildUserTurn（用户对话消息）、finalizeChatGeneration（成对入库；chat 无章节语义，
 *   后处理只保留正则显示清理 + 状态块解析，跳过标题解析——postprocessMessage 强制产
 *   title，会误剥 chat 正文首行的「#」文本）
 * 流编排共享内核见 hooks/generation-runtime.ts。
 */
import type { Message, MessageExtra } from '@shared/message';
import type { Work } from '@shared/work';

import type { MacroEnv } from '../../engine/types';
import { parseStatusBlock } from '../../engine/prompt/postprocess';
import { getRegexedString } from '../../engine/prompt/regex';
import type { ChatMember } from '../../engine/prompt/activation';
import { useGenerationStore } from '../../stores/generation';
import type { LlmPrefs } from '../../stores/settings';
import {
  GenerationFlowError,
  appendSwipe,
  toGenerationError,
} from '../../hooks/generation-flow';
import {
  buildMacroEnv,
  persistMessage,
  persistVariables,
  scanAndAssemble,
  type AssembleAssets,
  type FittedPrompt,
  type PendingVars,
} from '../../hooks/generation-pipeline';

/** chat 宏环境（§4.3/§5.1③）：char=本次激活角色、user=「用户」。
 *  复用 buildMacroEnv 的变量读写管线，仅覆盖 chat 语义 persona。 */
export function buildChatMacroEnv(work: Work, speaker: ChatMember, pending: PendingVars): MacroEnv {
  return { ...buildMacroEnv(work, speaker.name, pending), user: '用户' };
}

/** 用户对话消息（§4.2）：role=user / name=「用户」/ swipes=[text] */
export function buildUserTurn(text: string): Message {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    name: '用户',
    content: text,
    createdAt: Date.now(),
    swipes: [text],
    swipeId: 0,
    extra: {},
  };
}

/** AI 回复消息（chat 语义）：无 chapter 元数据，name=激活角色 */
function buildAssistantTurn(input: { content: string; speakerName: string; extra: MessageExtra }): Message {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    name: input.speakerName,
    content: input.content,
    createdAt: Date.now(),
    swipes: [input.content],
    swipeId: 0,
    extra: input.extra,
  };
}

/** 世界书扫描 + 总装 + tokenize 预算校验（chat：userText 走 userMessage 通道，薄调用共享管线） */
export async function scanAndAssembleChat(
  work: Work,
  messages: Message[],
  userMessage: string,
  assets: AssembleAssets,
  env: MacroEnv,
  prefs: LlmPrefs,
): Promise<FittedPrompt> {
  return scanAndAssemble(work, messages, { kind: 'userMessage', text: userMessage }, assets, env, prefs);
}

export interface ChatTurn {
  /** 新增的用户消息；仅 sendMessage 场景非空（swipe/继续不产生新 user 消息） */
  user: Message | null;
  assistant: Message;
}

export interface ChatFinalizeInput {
  work: Work;
  /** 本次生成的用户对话文本；swipe 重 roll 场景为空串（不产生新 user 消息） */
  userText: string;
  speaker: ChatMember;
  swipeTarget: Message | null;
  assets: AssembleAssets;
  env: MacroEnv;
  prefs: LlmPrefs;
  promptTokens: number;
  activatedIds: string[];
  startedAt: number;
  pending: PendingVars;
}

/** chat 完成收尾（§5.1⑥ / §9.2）：后处理 → 构造消息 → user+assistant 成对幂等入库 → 变量回写 */
export async function finalizeChatGeneration(input: ChatFinalizeInput): Promise<ChatTurn> {
  const raw = useGenerationStore.getState().buffer;
  const cleaned = getRegexedString(
    raw,
    'ai_output',
    { isMarkdown: false, isPrompt: false, macroEnv: input.env },
    input.assets.regexScripts,
  );
  const { statusSnapshot, content } = parseStatusBlock(cleaned);
  const extra: MessageExtra = {
    model: input.prefs.model || undefined,
    tokenCount: input.promptTokens,
    generationMs: Date.now() - input.startedAt,
    ...(statusSnapshot ? { statusSnapshot } : {}),
    ...(input.activatedIds.length ? { activatedEntries: input.activatedIds } : {}),
  };
  const user = input.userText.trim() ? buildUserTurn(input.userText) : null;
  const assistant = input.swipeTarget
    ? appendSwipe(input.swipeTarget, content, extra)
    : buildAssistantTurn({ content, speakerName: input.speaker.name, extra });
  try {
    // 入库顺序：先 user 后 assistant，保证 messages.jsonl 时序（同 id 幂等 upsert 可安全重试）
    if (user) await persistMessage(input.work.id, user);
    await persistMessage(input.work.id, assistant);
  } catch (err) {
    const ge = toGenerationError(err);
    throw new GenerationFlowError({ code: ge.code, message: `回复已生成，但入库失败：${ge.message}` });
  }
  await persistVariables(input.work, input.pending);
  useGenerationStore.getState().finish();
  useGenerationStore.getState().reset();
  return { user, assistant };
}
