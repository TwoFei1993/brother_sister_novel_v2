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
import { META_ONLY_PLACEHOLDER, extractThinking, mergeThinking, parseStatusBlock, presentable } from '../../engine/prompt/postprocess';
import { getRegexedString } from '../../engine/prompt/regex';
import type { ChatMember } from '../../engine/prompt/chat/activation';
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

import { uuid } from '../../lib/uuid';
/** chat 宏环境（§4.3/§5.1③）：char=本次激活角色、user=「用户」。
 *  复用 buildMacroEnv 的变量读写管线，仅覆盖 chat 语义 persona。 */
export function buildChatMacroEnv(work: Work, speaker: ChatMember, pending: PendingVars): MacroEnv {
  return { ...buildMacroEnv(work, speaker.name, pending), user: '用户' };
}

/** 用户对话消息（§4.2）：role=user / name=「用户」/ swipes=[text] */
export function buildUserTurn(text: string): Message {
  return {
    id: uuid(),
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
    id: uuid(),
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
  /** 元信息残章标记（深度测试 D7）：本轮只有思考/元信息——占位不入库，上层 isMetaOnlyTurn 据此自动重试 */
  metaOnly?: boolean;
}

/** 元信息残章自动重试后缀（对齐 novel 侧 META_RETRY_SUFFIX 语义；只进提示词不入库 user 消息） */
export const CHAT_META_RETRY_HINT =
  '\n\n（系统重试：上一轮输出只有思考/元信息没有对话正文，视为无效。这次请直接以角色身份输出对话与行动，不要输出思考过程或任何元信息。）';

/** 是否「正常完成但产物为元信息残章」（占位未入库的 turn；null=流中错误/停止，不算残章） */
export function isMetaOnlyTurn(turn: ChatTurn | null): boolean {
  return turn !== null && turn.metaOnly === true;
}

/** 单次生成编排参数（自 useChatGenerate 收口；runChatWithMetaRetry 需要透传） */
export interface ChatRunOptions {
  targetId: string;
  initialBuffer: string;
  /** swipe 重 roll：候选进该消息的 swipes，而非新建消息 */
  swipeTarget?: Message;
  /** 隐式引导（括号指令/空引导）：userText 进上下文，但不入库为 user 消息 */
  implicitUser?: boolean;
  /** 残章重试专用：守卫后缀只进提示词，入库的 user 消息保持干净原文本（对齐 novel promptDirective） */
  promptUserText?: string;
  /** 全体成员名（透传 finalize 做「他人名：」前缀剥离） */
  otherNames?: string[];
}

/** 单次生成流编排（chat：sendMessage/continue/swipe 共用的 run 形状） */
export type ChatRunFn = (
  history: Message[],
  userText: string,
  speaker: ChatMember,
  opts: ChatRunOptions,
) => Promise<ChatTurn | null>;

/** 元信息残章自动重试编排（深度测试 D7，对齐 novel useGenerate 语义；run 注入便于单测）：
 *  首轮产物 meta-only（占位未入库）→ 守卫后缀只进提示词（promptUserText）重发一次；
 *  重试后仍残章 → 不入库、error 进 store（错误条提示「本轮只生成了思考内容，请重试」）、返回 null。
 *  run 返回 null（流中错误/用户停止）不算残章，原样透传绝不重试。 */
export async function runChatWithMetaRetry(
  run: ChatRunFn,
  history: Message[],
  userText: string,
  speaker: ChatMember,
  opts: ChatRunOptions,
): Promise<ChatTurn | null> {
  let turn = await run(history, userText, speaker, opts);
  if (!isMetaOnlyTurn(turn)) return turn;
  turn = await run(history, userText, speaker, {
    ...opts,
    promptUserText: userText + CHAT_META_RETRY_HINT,
  });
  if (isMetaOnlyTurn(turn)) {
    useGenerationStore.getState().fail({ code: 'meta_only', message: '本轮只生成了思考内容，请重试' }, false);
    return null;
  }
  return turn;
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
  /** 全体成员名（chat 串名泄露剥离用） */
  otherNames?: string[];
}

/** chat 完成收尾（§5.1⑥ / §9.2）：后处理 → 构造消息 → user+assistant 成对幂等入库 → 变量回写。
 *  元信息残章（深度测试 D7）：净化后只剩思考/元信息 → 不入库、返回 metaOnly 占位 turn，
 *  交上层（useChatGenerate）带守卫后缀自动重试一次——不再以角色名义入库占位提示。 */
export async function finalizeChatGeneration(input: ChatFinalizeInput): Promise<ChatTurn> {
  const raw = useGenerationStore.getState().buffer;
  // 思考流捕获（用户反馈⑨ + D4 全链路）：流式 thinkingBuffer 优先，内嵌 <think> 标签兜底
  const { thinking: taggedThinking } = extractThinking(raw);
  const thinking = mergeThinking(useGenerationStore.getState().thinkingBuffer, taggedThinking);
  // 完整净化链（与 novel/显示层同源）：无标签思维流+尾部元信息+内置卫生层（预设片段 <Aniplex>、
  // 思维块、名字前缀等质检T4/对话实测泄露形态全覆盖）
  const hygiened = presentable(raw, input.speaker.name, input.otherNames);
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
    ...(thinking ? { rawThinking: thinking } : {}),
  };
  // 整轮输出只有思考/元信息：不入库（对齐 novel 语义），store 收束后交上层自动重试
  const metaOnly = !content.trim() || content.startsWith(META_ONLY_PLACEHOLDER);
  if (metaOnly) {
    useGenerationStore.getState().finish();
    useGenerationStore.getState().reset();
    return {
      user: null,
      assistant: buildAssistantTurn({ content, speakerName: input.speaker.name, extra }),
      metaOnly: true,
    };
  }
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
