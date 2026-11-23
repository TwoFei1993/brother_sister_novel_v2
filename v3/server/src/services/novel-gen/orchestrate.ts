/**
 * server 端章节编排入口（M2 Task 3.2）：章循环（书架批量多章链）+ 模式分发
 * （chapter/swipe/continue/append/expand）。单章链机械见 chapterChain.ts，收尾见 finalize.ts。
 *
 * 语义移植源：client useGenerate.ts（generateChapter/swipeRegenerate/continueFromPartial/
 * extendChapter 与旧批量循环的指令编排——批量循环已随客户端任务化删除）。
 * 章循环：第 1 章用 input.directive，第 2..N 章 = outline ? OUTLINE_DIRECTIVE : ''；
 * isCancelled 在章间与段间检查（真 → 返回已 done，D6）；单章失败停链返回 failed
 * （该章不入库，已入库保留）；批次屏障（BATCH_CHUNK_SIZE）重读磁盘最新态 + 强制进度落盘 +
 * 记忆抽取同步执行完再续写。
 */
import { randomUUID } from 'node:crypto';

import type { Message } from '@shared/message';
import {
  BATCH_CHUNK_SIZE,
  MAX_SWIPES,
  OUTLINE_DIRECTIVE,
  GenerationFlowError,
  buildContinueDirective,
  historyBeforeTarget,
  swipeLimitError,
  withPartialInHistory,
} from '@shared/hooks/generation-flow';
import { COLLAPSE_RETRY_SUFFIX, META_RETRY_SUFFIX } from '@shared/hooks/novel-constants';

import { readAll } from '../../storage/jsonl';
import { HttpError } from '../../middleware/validate';
import { assertSafeId, readWork } from '../../routes/works/works';
import { messagesFile } from '../../routes/works/messages';

import type { NovelGenPrefs } from './assemble';
import {
  continueTruncated,
  generateOneChapter,
  runOnce,
} from './chapterChain';
import { invalidReasonOf, progressOf, type ChainState, type RunOpts, type TaskProgress } from './chainState';
import { MEMORY_EXTRACT_EVERY, extractAndStoreMemoryServer, markTruncatedSwipe, readGlobalsSnapshot } from './finalize';

export type { TaskProgress } from './chainState';

export interface OrchestrateInput {
  workId: string;
  prefs: NovelGenPrefs; // server 端生成偏好（Task 1.1 prefsSchema 同构）
  mode: 'chapter' | 'swipe' | 'continue' | 'append' | 'expand';
  directive: string;
  chapters: number; // 多章链（书架批量）
  outline: boolean; // true=第 2..N 章用 OUTLINE_DIRECTIVE（按大纲链）
  targetId?: string; // swipe/append/expand 目标消息 id
  partial?: string; // continue 半成品基底
  isCancelled: () => boolean; // runner 注入：读任务文件 cancelRequested
  onProgress: (p: TaskProgress) => void; // runner 注入：节流落盘（1s）
}

export interface OrchestrateResult {
  done: number;
  /** 单章失败/模式失败原因（取消不是失败——无 failed 字段） */
  failed?: string;
  /** 停链原因：取消或任务级超时（isCancelled 为真时停链；已完成章保留，D6） */
  stopped?: 'cancelled-or-timeout';
  /** 本次任务入库消息 id 列表（D9：客户端同步本地视图的唯一依据） */
  messageIds: string[];
}

/** 失败原因归类（D6 执行中删书）：404 / WORK_MISSING → 「作品已删除」人话 */
function failedReasonOf(err: unknown): string {
  if (err instanceof GenerationFlowError && err.ge.code === 'WORK_MISSING') return err.ge.message;
  if (err instanceof HttpError && err.status === 404) return '作品已删除（生成执行中作品被删除）';
  return err instanceof Error ? err.message : String(err);
}

/** 章失败/模式失败的人话原因（末次上游错误优先） */
function invalidReasonText(st: ChainState): string {
  return st.lastError ? `上游无有效输出：${st.lastError}` : '模型输出无效（自动重试后仍未产出可用正文）';
}

/** 单目标模式成功收尾：saving 进度（done+1）+ messageIds 登记 */
function finishSingle(st: ChainState, messageIds: string[], msg: Message): OrchestrateResult {
  st.done = 1;
  st.onProgress(progressOf(st, 'saving', msg.content));
  messageIds.push(msg.id);
  return { done: 1, messageIds };
}

/**
 * 章节编排主入口：组装任务态（work/messages/全局变量快照）→ 按模式分发。
 * 任何异常（含执行中删书 404）归类为 failed 返回——调用方（runner）直接落任务终态。
 */
export async function orchestrateNovelChapters(input: OrchestrateInput): Promise<OrchestrateResult> {
  assertSafeId(input.workId);
  const messageIds: string[] = [];
  let st: ChainState | null = null;
  try {
    st = {
      workId: input.workId,
      prefs: input.prefs,
      work: await readWork(input.workId), // 作品不存在 → 404（failed 归类「作品已删除」）
      messages: await readAll<Message>(messagesFile(input.workId)),
      globals: await readGlobalsSnapshot(), // Task 3.1 挂账：buildMacroEnv 的 global 快照
      isCancelled: input.isCancelled,
      onProgress: input.onProgress,
      chapterIndex: 1,
      chapterTotal: 1,
      done: 0,
      finish: null,
      chapterText: '',
      lastError: '',
    };
    switch (input.mode) {
      case 'swipe':
        return await runSwipeMode(st, input, messageIds);
      case 'continue':
        return await runContinueMode(st, input, messageIds);
      case 'append':
      case 'expand':
        return await runExtendMode(st, input, messageIds, input.mode);
      default:
        return await runChapterChain(st, input, messageIds);
    }
  } catch (err) {
    return { done: st?.done ?? 0, failed: failedReasonOf(err), messageIds };
  }
}

// ---------- chapter 模式：多章链（书架批量；client 一键连写/按大纲的编排语义移植） ----------

async function runChapterChain(st: ChainState, input: OrchestrateInput, messageIds: string[]): Promise<OrchestrateResult> {
  const total = Math.max(1, Math.min(Math.floor(input.chapters) || 1, 50));
  st.chapterTotal = total;
  let completedInBatch = 0;
  for (let i = 1; i <= total; i += 1) {
    if (input.isCancelled()) return { done: st.done, stopped: 'cancelled-or-timeout', messageIds }; // 章间取消/超时（D6：已入库保留）
    st.chapterIndex = i;
    const directive = i === 1 ? input.directive : input.outline ? OUTLINE_DIRECTIVE : '';
    const outcome = await generateOneChapter(st, directive);
    if (outcome.cancelled) return { done: st.done, stopped: 'cancelled-or-timeout', messageIds }; // 段间取消/超时
    if (!outcome.msg) return { done: st.done, failed: outcome.reason ?? '生成失败', messageIds };
    messageIds.push(outcome.msg.id);
    st.done += 1;
    st.chapterText = outcome.msg.content;
    // 入库完成上报（saving + done+1；换章 text 由下一章链重置）
    st.onProgress(progressOf(st, 'saving', outcome.msg.content));
    // 自动记忆抽取（每 N 章一次；client 为 fire-and-forget，server 同步执行——批次屏障语义）
    const chapterIndex = outcome.msg.chapter?.index ?? 0;
    if (chapterIndex > 0 && chapterIndex % MEMORY_EXTRACT_EVERY === 0) {
      await extractAndStoreMemoryServer(input.workId, outcome.msg.content, chapterIndex, input.prefs).catch((e) =>
        console.warn('[novel-gen] 记忆抽取失败（不影响本章入库）', e),
      );
    }
    st.messages = [...st.messages, outcome.msg]; // 后续章上下文纳入本章（client upsertLocal 同语义）
    completedInBatch += 1;
    // 批次屏障（BATCH_CHUNK_SIZE）：每写满 N 章重读 work/messages 磁盘最新态 + 强制进度落盘，
    // （记忆抽取已在上方同步完成）再续写——deep-test 实测长批次质量退化的节奏防线保留
    if (completedInBatch >= BATCH_CHUNK_SIZE && i < total) {
      completedInBatch = 0;
      st.work = await readWork(input.workId);
      st.messages = await readAll<Message>(messagesFile(input.workId));
      st.chapterIndex = i + 1; // 屏障后进度指向下一章（text 重置）
      input.onProgress(progressOf(st, 'assembling', ''));
    }
  }
  return { done: st.done, messageIds };
}

// ---------- swipe 模式：重 roll 候选（client swipeRegenerate 同构） ----------

async function runSwipeMode(st: ChainState, input: OrchestrateInput, messageIds: string[]): Promise<OrchestrateResult> {
  const target = st.messages.find((m) => m.id === input.targetId);
  if (!target) return { done: 0, failed: '目标消息不存在（swipe）', messageIds };
  if (target.swipes.length >= MAX_SWIPES) return { done: 0, failed: swipeLimitError().message, messageIds };
  // 对齐 chat 语义：上下文取 target 之前（被重roll章节的旧候选不进上下文）
  const directive = target.directive ?? '';
  const ctx = historyBeforeTarget(st.messages, target.id);
  const tw = st.work.settings.targetChapterWords ?? 3000;
  let msg = await runOnce(st, ctx, directive, { targetId: target.id, swipeTarget: target });
  const reason = invalidReasonOf(msg);
  if (msg && reason) {
    msg = await runOnce(st, ctx, directive, {
      targetId: target.id,
      swipeTarget: target,
      promptDirective: directive + (reason === 'meta' ? META_RETRY_SUFFIX : COLLAPSE_RETRY_SUFFIX), // 后缀只进提示词
    });
  }
  // 重roll 同样走截断自动续写（候选经 swipeTarget 更新落库）
  const keepTitle = target.chapter?.title;
  msg = await continueTruncated(st, ctx, directive, msg, tw, (partial) => ({
    targetId: target.id,
    initialBuffer: partial,
    swipeTarget: target,
    promptDirective: directive,
    keepTitle,
    continueRemaining: Math.max(400, tw - partial.length),
    maxTokensScale: 2,
  }));
  // 最后防线：仅对有效产出标记（新候选位于末位 swipe——占位崩溃稿误标会指向崩溃候选）
  msg = await markTruncatedSwipe(st, msg, msg ? msg.swipes.length - 1 : 0);
  if (!msg || invalidReasonOf(msg) !== null) {
    return { done: 0, failed: invalidReasonText(st), messageIds }; // 保留原候选不动
  }
  return finishSingle(st, messageIds, msg);
}

// ---------- continue 模式：断流半成品续写（client continueFromPartial 同构） ----------

async function runContinueMode(st: ChainState, input: OrchestrateInput, messageIds: string[]): Promise<OrchestrateResult> {
  const partial = input.partial ?? '';
  if (!partial.trim()) return { done: 0, failed: '缺少续写基底（partial）', messageIds };
  // 续写轮语义（反馈③）：半章进历史 grounding + continuation 要求块（不要求章标题、禁止重开）
  const targetId = input.targetId ?? randomUUID();
  const directive = buildContinueDirective(partial);
  const msg = await runOnce(st, withPartialInHistory(st.messages, partial), directive, {
    targetId,
    initialBuffer: partial,
    continuation: true,
  });
  if (!msg || invalidReasonOf(msg) !== null) {
    return { done: 0, failed: invalidReasonText(st), messageIds };
  }
  return finishSingle(st, messageIds, msg);
}

// ---------- append / expand 模式：本章加长/续写（client extendChapter 同构） ----------

async function runExtendMode(
  st: ChainState,
  input: OrchestrateInput,
  messageIds: string[],
  mode: 'append' | 'expand',
): Promise<OrchestrateResult> {
  const target = st.messages.find((m) => m.id === input.targetId);
  if (!target) return { done: 0, failed: '目标消息不存在（extend）', messageIds };
  const idx = st.messages.findIndex((m) => m.id === target.id);
  // 上下文含本章（含 target 本体，模型看得到要续写/扩写的正文）；其后章节不进上下文
  const ctx = idx === -1 ? st.messages : st.messages.slice(0, idx + 1);
  const tw = st.work.settings.targetChapterWords ?? 3000;
  const isAppend = mode === 'append';
  // 加长目标字数：max(作品目标字数, 现有字数 + 1500)——「加长」必须比现在更长
  const expandTarget = Math.max(tw, target.content.length + 1500);
  const directive = isAppend
    ? buildContinueDirective(target.content)
    : `把本章加长扩写（保持情节不变，写到约 ${expandTarget} 字）`;
  st.chapterText = isAppend ? target.content : ''; // buffer 种子：append 流式呈现「旧文+新文」
  const baseOpts: RunOpts = {
    targetId: target.id,
    initialBuffer: isAppend ? target.content : '',
    swipeTarget: target,
    // 扩写轮关思考（生产实测：推理模型思考吞掉输出预算 → meta 空产出静默失败）
    ...(isAppend ? { continuation: true } : { expandChapter: true, thinkingOff: true }),
    maxTokensScale: 2, // 扩写/续写都是长输出：预算 2 倍（封顶 64000）
  };
  let msg = await runOnce(st, ctx, directive, baseOpts);
  const reason = invalidReasonOf(msg);
  if (msg && reason) {
    msg = await runOnce(st, ctx, directive, {
      ...baseOpts,
      promptDirective: directive + (reason === 'meta' ? META_RETRY_SUFFIX : COLLAPSE_RETRY_SUFFIX),
      maxTokensScale: 3,
    });
  }
  // 截断自动续写：append 走续写轮语义（无缝续写），expand 走常规语义（finish=length 时补写）
  msg = await continueTruncated(st, ctx, directive, msg, tw, (partial) => ({
    targetId: target.id,
    initialBuffer: partial,
    swipeTarget: target,
    ...(isAppend ? { continuation: true } : {}),
    maxTokensScale: 2,
  }));
  if (!msg || invalidReasonOf(msg) !== null) {
    return { done: 0, failed: invalidReasonText(st), messageIds };
  }
  return finishSingle(st, messageIds, msg);
}
