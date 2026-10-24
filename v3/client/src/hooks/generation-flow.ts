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
import { aiVersion, manualVersion, manualVersionName, nextAiVersionName, type DetectedAsset, type Message, type MessageExtra } from '@shared/message';

import { ApiError } from '../api/client';

import { uuid } from '../lib/uuid';
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

/** 重试退避：5s → 15s（实测上游 529 过载窗口常达数十秒，原 1s/3s 的重试只会连续撞墙） */
export function retryDelayMs(attempt: number): number {
  return attempt === 1 ? 5000 : 15000;
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

/** 每次 ⚡连写 的章数：深度测试实测长批次（10+ 章连续）第 6 章起出现重复循环退化，
 *  短批次控风险；仍受目标章节数上界约束（写到 target 即停） */
export const BATCH_CHUNK_SIZE = 3;

/** 批量生成进度（null = 空闲）：done=已完成章数（chunk 语义=已写到的最大章号），total=目标章数 */
export interface BatchProgress {
  done: number;
  total: number;
  /** chunk=⚡连写（缺省）；outline=📖按大纲 */
  mode?: 'chunk' | 'outline';
}

/** 批量进度文案（⏹ 停止按钮消费；大纲模式带「按大纲」前缀与连写区分） */
export function batchProgressText(b: BatchProgress): string {
  return b.mode === 'outline' ? `按大纲 ${b.done}/${b.total}` : `${b.done}/${b.total}`;
}

/** 📖按大纲生成的固定指令：本章要点由 scanAndAssemble 的 chapterOutlineDirective 按章号自动注入 */
export const OUTLINE_DIRECTIVE = '按本章大纲写';

/**
 * 📖按大纲生成计划（反馈⑤）：从「下一章」起写到 chapterOutlines 覆盖的最大章号
 * （区别于 desiredChapterCount——大纲写完即停，不凑目标章数）。
 * 无大纲（空/缺省）或下一章已超过最大章号（大纲覆盖完）→ null（无可写）。
 */
export function outlineRunPlan(
  messages: Message[],
  outlines: readonly { index: number }[] | undefined,
): { start: number; end: number; total: number } | null {
  const maxIndex = outlines?.reduce((mx, o) => Math.max(mx, o.index), 0) ?? 0;
  if (maxIndex <= 0) return null;
  const start = nextChapterIndex(messages);
  if (start > maxIndex) return null;
  return { start, end: maxIndex, total: maxIndex - start + 1 };
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
  /** 指定消息 id（重生成覆盖语义：重试携带首次消息 id，按 messageId 幂等覆盖落库行）；缺省新生成 */
  id?: string;
  /** tokenize 实测的提示词 token 数（审计进 extra.tokenCount） */
  promptTokens: number;
  generationMs: number;
  statusSnapshot?: Record<string, string | number>;
  activatedEntries?: string[];
  /** 模型思考流原文（用户反馈⑨；审计进 extra.rawThinking，前端折叠展示） */
  rawThinking?: string;
  /** 本章新素材检测清单（P2.2 side-channel；进 extra.newAssets 供前端确认绑定） */
  newAssets?: DetectedAsset[];
}

/** 构造入库消息（§4.2）：assistant /「小说家」/ swipes=[首版本 v1] / chapter 元数据 */
export function buildChapterMessage(input: ChapterMessageInput): Message {
  const extra: MessageExtra = {
    model: input.model,
    tokenCount: input.promptTokens,
    generationMs: input.generationMs,
    ...(input.statusSnapshot ? { statusSnapshot: input.statusSnapshot } : {}),
    ...(input.activatedEntries ? { activatedEntries: input.activatedEntries } : {}),
    ...(input.rawThinking ? { rawThinking: input.rawThinking } : {}),
    ...(input.newAssets && input.newAssets.length > 0 ? { newAssets: input.newAssets } : {}),
  };
  const createdAt = Date.now();
  return {
    id: input.id ?? uuid(),
    role: 'assistant',
    name: '小说家',
    content: input.content,
    createdAt,
    swipes: [aiVersion(input.content, 'v1', createdAt)],
    swipeId: 0,
    chapter: { index: input.chapterIndex, title: input.title },
    ...(input.directive ? { directive: input.directive } : {}),
    extra,
  };
}

/** swipe 重生成：新版本（AI，自动命名）push 进既有消息并切换指向（同 id 幂等 upsert） */
export function appendSwipe(target: Message, content: string, extra: MessageExtra): Message {
  const version = aiVersion(content, nextAiVersionName(target.swipes.map((v) => v.name)));
  return {
    ...target,
    content,
    swipes: [...target.swipes, version],
    swipeId: target.swipes.length,
    extra: { ...target.extra, ...extra },
  };
}

/**
 * 「生成新的版本并手改」（安卓 app Phase1）：复制当前版本全部内容为新版本（origin='手改'，
 * 命名「<基底名>手改M」），切换指向新版本；正文由作者在编辑器里继续修改后手动保存。
 */
export function forkManualVersion(target: Message): Message {
  const base = target.swipes[target.swipeId];
  if (!base) return target;
  const version = manualVersion(
    base.content,
    manualVersionName(base.name, target.swipes.map((v) => v.name)),
  );
  const swipes = [...target.swipes, version];
  return { ...target, content: version.content, swipes, swipeId: swipes.length - 1 };
}

/** 版本上限（前端控制；server MessageSchema 保持宽松不设限，review #13）；手改版本占同一数组 */
export const MAX_SWIPES = 50;

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
