/**
 * chat 生成非 hook 层（useChatGenerate 的管线层，对位 hooks/generation-pipeline.ts）
 *
 * 复用 vs 薄复制决策（任务要求注明；generation-pipeline.ts 不在本任务可改清单内）：
 * - 直接复用：loadAssembleAssets / persistMessage / persistVariables / appendSwipe /
 *   FittedPrompt / AssembleAssets / PendingVars / buildMacroEnv（变量读写管线）
 * - 薄复制 scanAndAssemble → scanAndAssembleChat：原函数固定向 assemblePrompt 传
 *   novel 语义 directive（会包装成「剧情指引：…」）；chat 语义要求走 userMessage
 *   通道（设计 §4.3 用户消息=对话内容，assemble.ts 已支持）。待原函数参数化后可收回
 * - 薄复制 finalize 的消息构造 → finalizeChatGeneration：chat 无章节语义
 *   （无 title/chapter 元数据、AI name=激活角色而非「小说家」）；后处理只保留
 *   正则显示清理 + 状态块解析，跳过标题解析（postprocessMessage 强制产 title，
 *   会误剥 chat 正文首行的「#」文本）
 */
import type { Message, MessageExtra } from '@shared/message';
import type { TavernCardV2 } from '@shared/tavern';
import type { Work } from '@shared/work';

import { tokenizeMessages, type GenerateMessage } from '../../api/llm';
import type { MacroEnv } from '../../engine/types';
import { assemblePrompt } from '../../engine/prompt/assemble';
import { parseStatusBlock } from '../../engine/prompt/postprocess';
import { getRegexedString } from '../../engine/prompt/regex';
import { scanWorldInfo, type ScanSettings } from '../../engine/worldbook';
import { useGenerationStore } from '../../stores/generation';
import type { LlmPrefs } from '../../stores/settings';
import type { ChatMember } from '../../engine/prompt/activation';
import {
  appendSwipe,
  GenerationFlowError,
  toGenerationError,
} from '../../hooks/generation-flow';
import {
  buildMacroEnv,
  EMPTY_PRESET as pipelineEmptyPreset,
  persistMessage,
  persistVariables,
  type AssembleAssets,
  type FittedPrompt,
  type PendingVars,
} from '../../hooks/generation-pipeline';

// 预设缺失兜底（标准 marker 骨架）收敛到 generation-pipeline，chat 与 novel 共用
const EMPTY_PRESET = pipelineEmptyPreset;

/** 世界书扫描全局设置（与 generation-pipeline 同值；其未导出故本地声明） */
const SCAN_SETTINGS: ScanSettings = {
  scanDepth: 10,
  caseSensitive: false,
  matchWholeWords: false,
  recursive: true,
  maxRecursionSteps: 10,
};

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

/** 世界书扫描 + 总装 + tokenize 预算校验（chat：userText 走 userMessage 通道） */
export async function scanAndAssembleChat(
  work: Work,
  messages: Message[],
  userMessage: string,
  assets: AssembleAssets,
  env: MacroEnv,
  prefs: LlmPrefs,
): Promise<FittedPrompt> {
  const scan = scanWorldInfo({
    books: assets.worldbooks,
    // 扫描池 = 本轮用户发言（最新文本，必扫）+ 历史消息（与 generation-pipeline 同语义）
    chatTexts: [userMessage, ...[...messages].reverse().map((m) => m.content)].filter(Boolean),
    settings: SCAN_SETTINGS,
    macroEnv: env,
  });
  const maxContext = prefs.maxContext ?? 8192;
  const maxTokens = prefs.maxTokens ?? 2048;
  const budget = Math.max(0, maxContext - maxTokens);

  let history = messages;
  for (;;) {
    const result = assemblePrompt({
      preset: assets.preset ?? EMPTY_PRESET,
      cards: assets.cards,
      allowCardOverride: work.allowCardOverride !== false,
      worldbookScan: scan,
      workSettings: work.settings,
      history,
      userMessage,
      macroEnv: env,
      budgetTokens: budget,
    });
    const assembled: GenerateMessage[] = result.messages.map((m) => ({
      role: m.role,
      ...(m.name ? { name: m.name } : {}),
      content: m.content,
    }));
    if (history.length === 0) {
      return { messages: assembled, promptTokens: result.usage.promptTokens, truncated: result.usage.truncated, activatedIds: result.activatedIds };
    }
    const { count } = await tokenizeMessages(prefs.source, prefs.model || undefined, assembled);
    if (count <= budget) {
      return { messages: assembled, promptTokens: count, truncated: result.usage.truncated, activatedIds: result.activatedIds };
    }
    const perMsg = count / Math.max(1, assembled.length);
    const drop = Math.min(history.length, Math.max(1, Math.ceil((count - budget) / perMsg)));
    history = history.slice(drop);
  }
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
