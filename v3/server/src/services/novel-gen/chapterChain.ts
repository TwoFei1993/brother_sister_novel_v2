/**
 * server 端单章生成链（M2 Task 3.2；移植源 client useGenerate.ts 的 generateChapter
 * :376-535 与 continueTruncated :297-354，D5 逐点对齐不允许语义漂移）。
 *
 * 链路：runOnce（组装 → 三级防线 LLM → finalizeChapter 幂等入库）→ 段间续写
 * （SEGMENT_WORDS 分段 / finish=stop 提前收束）/ 截断自动续写（≤MAX_TRUNCATE_ROUNDS 轮，
 * 重放回滚 + 重开检测）/ meta·collapse 后缀重试（后缀常量 shared novel-constants 单一事实源）。
 * 润色 pass 与 truncatedSwipeId 标记见 finalize.ts。
 *
 * 与 client 差异（IO 缝，语义等价）：store buffer → ChainState.chapterText（进度 text 与
 * 拼接基底）；store finishReason → ChainState.finish；persistMessage → upsertMessageInternal；
 * rescueFromStreamBreak 不移植（server 三级防线覆盖浏览器断流场景）。
 */
import { randomUUID } from 'node:crypto';

import type { Message } from '@shared/message';
import type { AssembleTail } from '@shared/engine/prompt/context-plan';
import { parseChapterTitle } from '@shared/engine/prompt/postprocess';
import { SEGMENT_WORDS } from '@shared/engine/prompt/novel/requirements';
import {
  buildContinueDirective,
  calcOutputBudget,
  isChapterRestart,
  isReplayedContinuation,
  looksTruncated,
  nextChapterIndex,
  withPartialInHistory,
} from '@shared/hooks/generation-flow';
import { COLLAPSE_RETRY_SUFFIX, MAX_TRUNCATE_ROUNDS, META_RETRY_SUFFIX } from '@shared/hooks/novel-constants';

import { collectWithDefense } from '../llm/defense';
import { upsertMessageInternal } from '../../routes/works/messages';
import { loadAssembleAssets } from './assets';
import { buildMacroEnv, scanAndAssemble, type PendingVars } from './assemble';
import { finalizeChapter, markTruncatedSwipe, polishChapter } from './finalize';
import { invalidReasonOf, progressOf, type ChapterOutcome, type ChainState, type RunOpts } from './chainState';

/** 一次「组装 → LLM → finalize 入库」的完整单轮（client run 的 server 等价物） */
export async function runOnce(
  st: ChainState,
  ctxMessages: Message[],
  directive: string,
  opts: RunOpts,
): Promise<Message | null> {
  const { work, prefs } = st;
  st.onProgress(progressOf(st, 'assembling')); // 组装开始
  // P2.2 绑定三态：按本章章号过滤增量绑定素材（写第 C 章只带 fromChapter≤C 的生效素材）
  const assets = await loadAssembleAssets(work, nextChapterIndex(ctxMessages));
  const pending: PendingVars = { work: new Map(), global: new Map() };
  const env = buildMacroEnv(work, assets.cards[0]?.data.name ?? undefined, pending, st.globals);
  // tail 构造逐点对照 client 旧组装通路（已随客户端任务化删除）。continueRemaining 接线
  // （挂账 a 修复）：此前 RunOpts 声明并计算了但 tail 从未传——508bbd7「补完剩余字数后
  // 收束」防章节膨胀的根因修复从未激活（client 旧 tail 同病）；分段轮传了也会被
  // pickChapterRequirement 的 segment 分支忽略，故仅续写轮（continueTruncated）实际生效
  const tail: AssembleTail = {
    kind: 'directive',
    text: opts.promptDirective ?? directive,
    ...(opts.continuation ? { continuation: true } : {}),
    ...(opts.expandChapter ? { expandChapter: true } : {}),
    ...(opts.segment ? { segment: opts.segment } : {}),
    ...(opts.continueRemaining !== undefined ? { continueRemaining: opts.continueRemaining } : {}),
  };
  const fitted = await scanAndAssemble(work, ctxMessages, tail, assets, env, prefs);
  const thinkingOn = prefs.thinking !== false;
  const targetWords = work.settings.targetChapterWords ?? 3000;
  const effMaxTokens =
    opts.effMaxTokensOverride ?? calcOutputBudget(targetWords, thinkingOn, opts.maxTokensScale ?? 1);
  st.onProgress(progressOf(st, opts.continuation ? 'continuing' : 'generating'));
  const startedAt = Date.now();
  const r = await collectWithDefense({
    source: prefs.source,
    model: prefs.model ?? '',
    messages: fitted.messages,
    // 采样参数映射与 client buildGenerateBody 同构（thinking 仅 true 时下发）
    params: {
      ...(prefs.temperature !== undefined ? { temperature: prefs.temperature } : {}),
      ...(prefs.frequencyPenalty !== undefined ? { frequency_penalty: prefs.frequencyPenalty } : {}),
      ...(prefs.presencePenalty !== undefined ? { presence_penalty: prefs.presencePenalty } : {}),
      ...(prefs.repetitionPenalty !== undefined ? { repetition_penalty: prefs.repetitionPenalty } : {}),
      ...(!opts.thinkingOff && thinkingOn ? { thinking: true } : {}),
    },
    maxTokens: effMaxTokens,
  });
  st.finish = r.finish;
  st.lastError = r.text.trim() ? '' : r.lastErr;
  const msg = await finalizeChapter({
    work,
    messages: ctxMessages,
    directive,
    swipeTarget: opts.swipeTarget ?? null,
    assets,
    env,
    prefs,
    promptTokens: fitted.promptTokens,
    activatedIds: fitted.activatedIds,
    startedAt,
    pending,
    buffer: (opts.initialBuffer ?? '') + r.text,
    thinking: r.thinking,
    ...(opts.persistMessageId ? { messageId: opts.persistMessageId } : {}),
    ...(opts.keepTitle ? { keepTitle: opts.keepTitle } : {}),
  });
  st.chapterText = msg.content;
  return msg;
}

/** 续写轮结果三态处理（continueTruncated 与分段链共用——client 双处重复块的 server 收敛）：
 *  重放 → 回滚为已写内容并停链；重开 → 丢弃旧半章只留新章并停链；正常 → 元数据还原为 prev 续链 */
async function settleContinuation(
  st: ChainState,
  prev: Message,
  next: Message | null,
): Promise<{ msg: Message | null; stop: boolean }> {
  const partial = prev.content;
  // 重放保护：上游把已有内容从头复述（短流×字数兜底误判组合）→ 整体回滚本轮并停止——
  // content 之外 chapter.title/directive 也一并还原（续写轮 finalize 会把指令文本污染进
  // title 的回退路径），同 id 幂等覆盖回写
  if (next && isReplayedContinuation(partial, next.content)) {
    const rolled = { ...next, content: partial, directive: prev.directive };
    if (prev.chapter) rolled.chapter = { ...prev.chapter };
    await upsertMessageInternal(st.workId, rolled);
    st.chapterText = rolled.content;
    return { msg: rolled, stop: true };
  }
  // 重开保护：新增段以章标题开头 = 模型无视续写纪律重新开章 → 丢弃旧半章、只保留新章
  //（parseChapterTitle 把新章标题剥进 chapter 元数据；旧 chapter.title 保留为兜底）
  const added = next && next.content.length > partial.length ? next.content.slice(partial.length) : '';
  if (next && added.trim().length >= 8 && isChapterRestart(added)) {
    const parsed = parseChapterTitle(added.trim(), undefined, prev.chapter?.index ?? 0);
    const cleanTitle = parsed.title && !/^第\d+章$/.test(parsed.title) ? parsed.title : (prev.chapter?.title ?? '');
    const rolled: Message = {
      ...next,
      content: parsed.content,
      directive: prev.directive,
      swipes: next.swipes.map((v, i) => (i === next.swipeId ? { ...v, content: parsed.content } : v)),
      ...(prev.chapter ? { chapter: { ...prev.chapter, title: cleanTitle } } : {}),
    };
    await upsertMessageInternal(st.workId, rolled);
    st.chapterText = rolled.content;
    return { msg: rolled, stop: true };
  }
  // 正常续写：chapter/directive 还原为 prev（章节身份不变；title 不被续写指令污染）。
  // client 平价：还原仅内存态不落库（落库行保持续写轮 finalize 的中间态元数据）
  return {
    msg: next ? { ...next, directive: prev.directive, ...(prev.chapter ? { chapter: { ...prev.chapter } } : {}) } : next,
    stop: false,
  };
}

/**
 * 截断自动续写（client continueTruncated 同构）：双判据 looksTruncated（finish 明示 /
 * 无 finish 帧时启发式+字数兜底）；续写轮 grounding（半章进历史）+ continuation 要求块。
 */
export async function continueTruncated(
  st: ChainState,
  ctxMessages: Message[],
  directive: string,
  first: Message | null,
  tw: number,
  runOpts: (partial: string) => RunOpts,
): Promise<Message | null> {
  let msg = first;
  const targetWords = st.work.settings.targetChapterWords ?? 3000;
  for (let rounds = 0; rounds < MAX_TRUNCATE_ROUNDS && msg; rounds += 1) {
    if (st.isCancelled()) break; // 段间取消（client 由 abort 实现，server 读任务文件标志）
    if (!looksTruncated(st.finish, msg.content, targetWords)) break;
    const prev = msg;
    const partial = msg.content;
    // 续写轮按「补完剩余字数后收束」（target − 已有）：防每轮再写满额字数导致章节膨胀
    const remaining = Math.max(400, targetWords - partial.length);
    const next = await runOnce(st, withPartialInHistory(ctxMessages, partial), buildContinueDirective(partial), {
      ...runOpts(partial),
      continuation: true,
      continueRemaining: remaining,
    });
    const settled = await settleContinuation(st, prev, next);
    msg = settled.msg;
    if (settled.stop) break;
  }
  return msg;
}

/**
 * 单章生成链（client generateChapter :376-535 全语义移植）：
 * 分段链（parts=ceil(tw/SEGMENT_WORDS)）→ meta/collapse 后缀重试 → 段间续写或截断续写 →
 * 润色 → truncatedSwipeId 标记。失败返回 null（调用方停链，已入库保留）。
 */
export async function generateOneChapter(st: ChainState, directive: string): Promise<ChapterOutcome> {
  // 重试复用同一 targetId：入库按 messageId 幂等 upsert，重试结果覆盖首次无效行
  const targetId = randomUUID();
  const tw = st.work.settings.targetChapterWords ?? 3000;
  const parts = Math.max(1, Math.ceil(tw / SEGMENT_WORDS));
  const thinkingOn = st.prefs.thinking !== false;
  // 段预算 = 段目标字数直算（+600 旧 buffer 移除——「写满预算」型模型下 buffer 就是超写额度）
  const segmentBudget = calcOutputBudget(SEGMENT_WORDS, thinkingOn, 1);
  st.chapterText = ''; // 换章重置（进度 text）
  const seg1 = parts > 1 ? { part: 1, parts, words: SEGMENT_WORDS } : undefined;
  // 第 1 段：段级预算（写满即停，后续段自动续写）+ 分段要求块（非末段不收尾）
  let msg = await runOnce(st, st.messages, directive, {
    targetId,
    ...(seg1 ? { segment: seg1, effMaxTokensOverride: segmentBudget } : {}),
  });
  const reason = invalidReasonOf(msg);
  if (msg && reason) {
    // 残章/重复循环：带专用重试后缀再来一次（后缀只进提示词；按首次消息 id 幂等覆盖）。
    // meta 的本质常是「思考吃满输出预算」——重试预算 ×2（思考与正文各翻倍；旧 ×3 会让
    // 「写满预算」型模型把正文也放飞到 3 倍容量，字数失控的第二来源）
    msg = await runOnce(st, st.messages, directive, {
      targetId,
      promptDirective: directive + (reason === 'meta' ? META_RETRY_SUFFIX : COLLAPSE_RETRY_SUFFIX),
      persistMessageId: msg.id,
      maxTokensScale: 2,
      ...(seg1 ? { segment: seg1 } : {}),
    });
  }
  if (parts > 1) {
    // 第 2..parts 段：续写语义（无缝续写要求块 + 半章进历史 grounding），
    // finish=stop 尊重模型提前收束；重放/重开检测与元数据还原同 continueTruncated
    for (let part = 2; part <= parts && msg; part += 1) {
      if (st.isCancelled()) return { msg: null, cancelled: true };
      if (st.finish === 'stop') break; // 模型自然收束 → 分段链提前完成
      const prev = msg;
      // 续写段预算跟随 remaining（「补多少字给多少容量」）：要求块说补 400 字就给 ~600 字
      // 容量——旧全额段预算下模型写满即再超 4000 字（7081 字生产案例的第二来源）
      const remaining = Math.max(400, tw - prev.content.length);
      const next = await runOnce(st, withPartialInHistory(st.messages, prev.content), buildContinueDirective(prev.content), {
        targetId,
        initialBuffer: prev.content,
        promptDirective: directive,
        persistMessageId: prev.id, // 当前累积行 id（run1 由 finalize 生成 uuid）
        continuation: true,
        segment: { part, parts, words: SEGMENT_WORDS },
        effMaxTokensOverride: calcOutputBudget(remaining + 200, thinkingOn, 1),
        maxTokensScale: 1,
      });
      const settled = await settleContinuation(st, prev, next);
      msg = settled.msg;
      if (settled.stop) break;
    }
  } else {
    // 截断自动续写（补完结果同 id 幂等覆盖）：预算跟随 remaining（同分段续写，×2 旧补偿移除）
    const baseId = msg?.id ?? targetId;
    const keepTitle = msg?.chapter?.title;
    msg = await continueTruncated(st, st.messages, directive, msg, tw, (partial) => ({
      targetId,
      initialBuffer: partial,
      promptDirective: directive,
      persistMessageId: baseId,
      keepTitle,
      continueRemaining: Math.max(400, tw - partial.length),
      effMaxTokensOverride: calcOutputBudget(Math.max(400, tw - partial.length) + 200, thinkingOn, 1),
    }));
  }
  // 润色 pass（P2-2）：仅对有效产出润色；失败静默保留原稿
  msg = await polishChapter(st, msg);
  // 最后防线：仅对有效产出标记，且在润色之后（润色生成新版本时标记跟随最终版本）
  msg = await markTruncatedSwipe(st, msg, msg?.swipeId ?? 0);
  if (!msg || invalidReasonOf(msg) !== null) {
    return {
      msg: null,
      reason: st.lastError ? `上游无有效输出：${st.lastError}` : '模型输出无效（自动重试后仍未产出可用正文）',
    };
  }
  return { msg };
}
