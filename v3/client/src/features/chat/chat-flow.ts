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
import { CHAT_REPLY_LENGTH_RANGE, DEFAULT_CHAT_REPLY_LENGTH, type ChatReplyLength, type Work } from '@shared/work';

import type { MacroEnv } from '../../engine/types';
import { parseStatusBlock, sanitizeOutput } from '../../engine/prompt/postprocess';
import { getRegexedString } from '../../engine/prompt/regex';
import type { ChatMember } from '../../engine/prompt/activation';
import type { GenerateMessage } from '../../api/llm';
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

/**
 * 回复长度提示（组装后处理，纯函数）：在 messages 末尾追加一条 system 长度约束。
 *
 * 位置选择：追加在数组最末尾（即最后一条 user 消息之后）——chat-completions 系模型
 * 对越贴近生成点的指令遵循越强（酒馆 post_history_instructions 同理放末尾），且
 * system 角色不会被模型当作对话内容续写。绑定预设的作品同样受控（用户反馈四问③：
 * 兜底提示词只管无预设路径，绑定预设时长度约束会丢失，故在后处理层统一兜住）。
 * 注：追加发生在 tokenize 之后，hint 约 40 token，对预算校验的低估可忽略。
 */
export function appendReplyLengthHint(messages: GenerateMessage[], replyLength: ChatReplyLength): GenerateMessage[] {
  const { min, max } = CHAT_REPLY_LENGTH_RANGE[replyLength];
  return [
    ...messages,
    {
      role: 'system',
      content: `（本轮回复长度要求：约${min}-${max}字。以小说笔法展开对话与心理描写，不要明显超出上限字数。）`,
    },
  ];
}

/** 世界书扫描 + 总装 + tokenize 预算校验（chat：userText 走 userMessage 通道，薄调用共享管线），
 *  组装后统一追加回复长度提示（绑定预设与否均生效） */
export async function scanAndAssembleChat(
  work: Work,
  messages: Message[],
  userMessage: string,
  assets: AssembleAssets,
  env: MacroEnv,
  prefs: LlmPrefs,
): Promise<FittedPrompt> {
  const fitted = await scanAndAssemble(work, messages, { kind: 'userMessage', text: userMessage }, assets, env, prefs);
  return {
    ...fitted,
    messages: appendReplyLengthHint(fitted.messages, work.settings.chatReplyLength ?? DEFAULT_CHAT_REPLY_LENGTH),
  };
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
  // 内置卫生层：思考块/角色名前缀剥离（质量测试 T4/T5 发现的残留问题）
  const hygiened = sanitizeOutput(raw, input.speaker.name);
  const cleaned = getRegexedString(
    hygiened,
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

// ---------- 自动连播状态机（用户反馈四问④；纯函数便于单测，UI 接线在 ChatWorkspace） ----------

/** 自动连播轮间隔（上一条 AI 回复完成后延迟再发下一轮） */
export const AUTO_CHAT_DELAY_MS = 1500;

/**
 * 连播状态：enabled=自动模式开关；remaining=本轮剩余可连发条数。
 * 配额语义：每次用户手动发送重置为 members.length（全体成员各轮到一次即暂停，
 * 防无限自嗨）；自动每发一条扣 1，扣到 0 暂停等待用户。
 */
export interface AutoChatState {
  enabled: boolean;
  remaining: number;
}

export const INITIAL_AUTO_STATE: AutoChatState = { enabled: false, remaining: 0 };

/** 切换自动开关：开启时发放满额配额；关闭即复位 */
export function autoToggle(s: AutoChatState, membersCount: number): AutoChatState {
  return s.enabled ? INITIAL_AUTO_STATE : { enabled: true, remaining: membersCount };
}

/** 用户手动发送：重置连发配额（开关状态不变，关闭时不生效） */
export function autoOnManualSend(s: AutoChatState, membersCount: number): AutoChatState {
  return { ...s, remaining: membersCount };
}

/** 自动发送一条后扣减配额 */
export function autoConsume(s: AutoChatState): AutoChatState {
  return { ...s, remaining: Math.max(0, s.remaining - 1) };
}

/** 是否应在延迟后自动发送下一轮 */
export function autoShouldSend(s: AutoChatState): boolean {
  return s.enabled && s.remaining > 0;
}
