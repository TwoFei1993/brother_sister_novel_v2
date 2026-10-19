/**
 * 生成流纯函数内核（useGenerate 的可测层，设计 §9.1 重试 / §9.2 继续语义 / §4.2 消息构造）
 *
 * - shouldRetry / retryDelayMs / sleep：网络类错误自动重试（指数退避 ≤2 次）
 * - buildContinueDirective：§9.2 继续语义（半成品尾部作续写指令）
 * - buildChapterMessage / appendSwipe：§4.2 消息构造（入库幂等负载）
 * - toGenerationError：错误统一转义（SSE 帧 / ApiError / AbortError / 未知）
 *
 * 不依赖 React、store 与 api 层，全部可单测。编排辅助见 generation-pipeline.ts。
 */
import type { Message, MessageExtra } from '@shared/message';

import { ApiError } from '../api/client';

export interface GenerationError {
  code: string;
  message: string;
}

/** 网络类错误码（server LLM_NET/LLM_TIMEOUT + 客户端 network/静默断流）——可自动重试 */
const RETRYABLE_CODES = new Set(['LLM_NET', 'LLM_TIMEOUT', 'network', 'streamIncomplete']);
/** 额外重试次数上限（首次为 attempt=0，共至多 3 次尝试） */
export const MAX_RETRIES = 2;

/**
 * 是否应自动重试（§9.1）：网络类错误、尚未产出任何内容、重试额度未用尽。
 * 已产出内容 → 不重试（走 §9.2 partialKept「继续」路径，避免重复前文）。
 * streamIncomplete（静默断流）按网络类处理：0 chunk 可重试，已有半成品不重试。
 */
export function shouldRetry(error: GenerationError, chunksReceived: number, attempt: number): boolean {
  if (chunksReceived > 0) return false;
  if (attempt >= MAX_RETRIES) return false;
  return RETRYABLE_CODES.has(error.code);
}

/** 重试退避（指数）：1s → 3s */
export function retryDelayMs(attempt: number): number {
  return attempt === 1 ? 3000 : 1000;
}

/** 可中断 sleep（退避等待；signal 触发即以 AbortError 拒绝） */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      },
      { once: true },
    );
  });
}

/** 「继续」指令：以半成品尾部 200 字作衔接锚点（§9.2 重组上下文再发起，非续传） */
const CONTINUE_TAIL_CHARS = 200;

export function buildContinueDirective(partial: string): string {
  const tail = partial.trimEnd().slice(-CONTINUE_TAIL_CHARS);
  return `接着写完这一章，从下面已写内容的结尾自然续写，保持行文连贯，不要重复已有文字：\n\n…${tail}`;
}

/** 下一章号：现有最大 chapter.index + 1；无章节消息则 1 */
export function nextChapterIndex(messages: Message[]): number {
  return messages.reduce((mx, m) => Math.max(mx, m.chapter?.index ?? 0), 0) + 1;
}

/** 连写剩余章数：目标章数 − 已写到的最大章号（负数归零；断号章节由下一轮补齐语义自然衔接） */
export function remainingChapters(messages: Message[], targetCount: number): number {
  return Math.max(0, targetCount - (nextChapterIndex(messages) - 1));
}

/** 错误统一转义：SSE error 帧对象 / ApiError / AbortError / 未知 Error */
export function toGenerationError(err: unknown): GenerationError {
  if (err instanceof ApiError) return { code: err.code, message: err.message };
  if (err instanceof Error) {
    if (err.name === 'AbortError') return { code: 'aborted', message: '已停止生成' };
    return { code: 'unknown', message: err.message || '未知错误' };
  }
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: unknown; message?: unknown };
    if (typeof e.code === 'string') {
      return { code: e.code, message: typeof e.message === 'string' ? e.message : '生成失败' };
    }
  }
  return { code: 'unknown', message: '生成失败' };
}

/** 流程内部错误包装：携带已转义的 GenerationError 上抛（区别于原始异常） */
export class GenerationFlowError extends Error {
  constructor(readonly ge: GenerationError) {
    super(ge.message);
    this.name = 'GenerationFlowError';
  }
}

export interface ChapterMessageInput {
  content: string;
  title: string;
  chapterIndex: number;
  directive?: string;
  model?: string;
  /** tokenize 实测的提示词 token 数（审计进 extra.tokenCount） */
  promptTokens: number;
  generationMs: number;
  statusSnapshot?: Record<string, string | number>;
  activatedEntries?: string[];
}

/** 构造入库消息（§4.2）：assistant /「小说家」/ swipes=[content] / chapter 元数据 */
export function buildChapterMessage(input: ChapterMessageInput): Message {
  const extra: MessageExtra = {
    model: input.model,
    tokenCount: input.promptTokens,
    generationMs: input.generationMs,
    ...(input.statusSnapshot ? { statusSnapshot: input.statusSnapshot } : {}),
    ...(input.activatedEntries ? { activatedEntries: input.activatedEntries } : {}),
  };
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    name: '小说家',
    content: input.content,
    createdAt: Date.now(),
    swipes: [input.content],
    swipeId: 0,
    chapter: { index: input.chapterIndex, title: input.title },
    ...(input.directive ? { directive: input.directive } : {}),
    extra,
  };
}

/** swipe 重生成：新候选 push 进既有消息并切换指向（同 id 幂等 upsert） */
export function appendSwipe(target: Message, content: string, extra: MessageExtra): Message {
  return {
    ...target,
    content,
    swipes: [...target.swipes, content],
    swipeId: target.swipes.length,
    extra: { ...target.extra, ...extra },
  };
}

/** swipe 候选上限（前端控制；server MessageSchema 保持宽松不设限，review #13） */
export const MAX_SWIPES = 20;

/** 候选满额错误（swipeRegenerate 追加前检查；上限调整只需改 MAX_SWIPES） */
export function swipeLimitError(): GenerationError {
  return { code: 'SWIPE_LIMIT', message: `候选已达上限（${MAX_SWIPES}），请先清理` };
}

/**
 * swipe 重 roll 的组装上下文：目标消息之前的部分（review #10）。
 * 被重 roll 消息的旧候选不进上下文；目标不在列表（已刷新等）→ 全量兜底。
 */
export function historyBeforeTarget(messages: Message[], targetId: string): Message[] {
  const idx = messages.findIndex((m) => m.id === targetId);
  return idx === -1 ? messages : messages.slice(0, idx);
}
