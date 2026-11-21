/**
 * 生成流 hook（novel 语义，设计 §3.2 数据流 / §9.1 重试 / §9.2 生成事务性）
 *
 * generateChapter：组装（directive 通道：拉绑定资产 → 世界书扫描 → 总装 → tokenize 校验）
 *   → POST /api/llm/generate SSE → 逐 chunk 进 generationStore
 *   → 完成后处理（正则/标题/状态块）→ 构造 Message 幂等入库
 * continueFromPartial：断流半成品 +「继续」= 以续写指令重组上下文再发起（非续传）
 * swipeRegenerate：同 directive 重生成，候选 push 进既有消息的 swipes
 *   （上下文取 target 之前，旧候选不进上下文；候选达 MAX_SWIPES 上限拒绝）
 * 流编排（重试/停止/事务 fail）统一走 generation-runtime 共享内核（与 chat 同构）。
 * 真实 UI 接线属 Task 20（WorkPage/CommandBar）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

import { apiFetch } from '../api/client';

import { buildGenerateBody, cachedOutputBudget, type GenerateBody } from '../api/llm';
import { isCollapsedText } from '../engine/prompt/novel/collapse-detect';
import { useGenerationStore } from '../stores/generation';
import { useSettingsStore, type LlmPrefs } from '../stores/settings';
import { useWorkStore } from '../stores/work';
import { consumeResult, peekResult, submitTask, taskPending, waitAndStore } from '../lib/llmTask';

import {
  MAX_SWIPES,
  buildContinueDirective,
  toGenerationError,
  calcOutputBudget,
  historyBeforeTarget,
  isChapterRestart,
  isReplayedContinuation,
  looksTruncated,
  nextChapterIndex,
  swipeLimitError,
  withPartialInHistory,
  type BatchProgress,
} from './generation-flow';
import { COLLAPSE_RETRY_SUFFIX, MAX_TRUNCATE_ROUNDS, META_RETRY_SUFFIX } from '@shared/hooks/novel-constants';
import { runChunkLoop, runOutlineLoop } from './generation-batch';
import { persistMessage } from './generation-pipeline';
import { runGenerationStream } from './generation-runtime';
import { META_ONLY_PLACEHOLDER, parseChapterTitle } from '../engine/prompt/postprocess';
import { SEGMENT_WORDS, type SegmentInfo } from '../engine/prompt/novel/requirements';
import {
  buildMacroEnv,
  finalizeGeneration,
  loadAssembleAssets,
  scanAndAssemble,
  type AssembleAssets,
  type AssembleTail,
  type PendingVars,
  type FittedPrompt,
} from './generation-pipeline';
import type { MacroEnv } from '../engine/types';

import { uuid } from '../lib/uuid';
/** 单次生成的编排参数（targetId 预生成 uuid 作入库幂等键） */
interface RunOptions {
  targetId: string;
  initialBuffer: string;
  /** swipe 重生成：候选进该消息的 swipes，而非新建消息 */
  swipeTarget?: Message;
  /** 重试等场景：只替换提示词尾的指令文本（wire）；入库的 directive 元数据仍用干净原指令 */
  promptDirective?: string;
  /** 无效输出重试：携带首次消息 id，落库行按 messageId 幂等覆盖（不产生重复章节行） */
  persistMessageId?: string;
  /** 输出预算倍率（meta/崩溃重试对症「思考吃满 max_tokens」：预算不变的重试注定再失败） */
  maxTokensScale?: number;
  /** 续写轮（用户反馈③）：要求块与输出守卫切「无缝续写」变体，不要求章标题、禁止重新开章 */
  continuation?: boolean;
  /** 扩写轮（用户需求：本章加长）：要求块切「扩写本章」变体（基于上下文最后的当前版本输出更长完整章） */
  expandChapter?: boolean;
  /** 分段生成（用户需求：单段太长主动拆分）：进 tail 要求块（分段字数/停笔纪律），末段收束本章 */
  segment?: SegmentInfo;
  /** 覆盖输出预算（分段轮：只给本段的量 → finish=length 提前停，后续段自动续写） */
  effMaxTokensOverride?: number;
  /** 关闭思考（扩写轮实测：推理模型思考吞掉输出预算 → meta 空产出；扩写是转换任务不需要深思考） */
  thinkingOff?: boolean;
  /** 续写轮剩余字数（target − 已有）：要求块按「补完剩余后收束」改写，防章节膨胀 */
  continueRemaining?: number;
  /** 章节 title 兜底（续写轮沿用原章标题，防指令首句污染 title） */
  keepTitle?: string;
}

/**
 * 组装章级生成请求（SSE 与后台任务共用——2026-11-19 App 后台生成：同一组装两条通路，
 * 切后台/锁屏时前台 SSE 必断（WebView 暂停），后台任务在 server 端继续执行）。
 */
async function assembleGenRequest(
  work: Work,
  messages: Message[],
  directive: string,
  opts: Pick<RunOptions, 'initialBuffer' | 'promptDirective' | 'continuation' | 'expandChapter' | 'segment' | 'effMaxTokensOverride' | 'maxTokensScale' | 'persistMessageId' | 'swipeTarget' | 'thinkingOff' | 'continueRemaining' | 'keepTitle'>,
  prefs: LlmPrefs,
): Promise<{ body: GenerateBody; fitted: FittedPrompt; assets: AssembleAssets; env: MacroEnv; pending: PendingVars; effMaxTokens: number }> {
  // P2.2 绑定三态：按本章章号过滤增量绑定素材（写第 C 章只带 fromChapter≤C 的生效素材）
  const assets: AssembleAssets = await loadAssembleAssets(work, nextChapterIndex(messages));
  const pending: PendingVars = { work: new Map(), global: new Map() };
  const env = buildMacroEnv(work, assets.cards[0]?.data.name ?? undefined, pending);
  const tail: AssembleTail = {
    kind: 'directive',
    text: opts.promptDirective ?? directive,
    ...(opts.continuation ? { continuation: true } : {}),
    ...(opts.expandChapter ? { expandChapter: true } : {}),
    ...(opts.segment ? { segment: opts.segment } : {}),
  };
  const fitted = await scanAndAssemble(work, messages, tail, assets, env, prefs);
  const thinkingOn = prefs.thinking !== false;
  const targetWords = work.settings.targetChapterWords ?? 3000;
  const known = cachedOutputBudget(prefs.source, prefs.model);
  const effMaxTokens = Math.min(
    opts.effMaxTokensOverride ?? calcOutputBudget(targetWords, thinkingOn, opts.maxTokensScale ?? 1),
    known ?? Number.MAX_SAFE_INTEGER,
  );
  const body = buildGenerateBody({
    source: prefs.source,
    model: prefs.model,
    messages: fitted.messages,
    temperature: prefs.temperature,
    maxTokens: effMaxTokens,
    frequencyPenalty: prefs.frequencyPenalty,
    presencePenalty: prefs.presencePenalty,
    repetitionPenalty: prefs.repetitionPenalty,
    thinking: opts.thinkingOff ? false : thinkingOn,
  });
  return { body, fitted, assets, env, pending, effMaxTokens };
}

// ---------- App 后台生成（用户需求：切后台/锁屏不再「流式连接中断」白跑） ----------
// 复用向导的 bg 任务基建（server 端执行 + 轮询取回，三级稳定性防线在 server 侧）；
// 分段链在客户端驱动：每段一个 server 任务，完成即按消息 id 幂等覆盖累积落库（中断只损当段）。

/** 链状态持久化键（页面重载后恢复剩余段；partial 从库中 targetId 行读，不落 localStorage） */
function novelBgPendingKey(workId: string): string {
  return `novel-gen-bg-pending-${workId}`;
}

interface NovelBgPending {
  directive: string;
  targetId: string;
  /** 下一段（1 起）；已完成的段已入库 */
  part: number;
  parts: number;
}

function readNovelBgPending(workId: string): NovelBgPending | null {
  try {
    return JSON.parse(localStorage.getItem(novelBgPendingKey(workId)) ?? 'null') as NovelBgPending | null;
  } catch {
    return null;
  }
}

/** 连写/大纲批次进度类型与常量已收敛至 generation-flow（BatchProgress/BATCH_CHUNK_SIZE） */

export interface UseGenerateResult {
  streaming: boolean;
  /** 正在生成的作品 id（null=无生成；全局单槽，跨书访问时 UI 据此区分本书/别书） */
  streamingWorkId: string | null;
  buffer: string;
  /** 思考流原文（推理模型💭；移动端 DeepSeek 式折叠块消费） */
  thinkingBuffer: string;
  error: { code: string; message: string } | null;
  partialKept: boolean;
  targetMessageId: string | null;
  /** novel 模式：按剧情指令生成一章，返回入库消息（失败返回 null） */
  generateChapter: (work: Work, messages: Message[], directive: string) => Promise<Message | null>;
  /** 断流后「继续」：半成品作基底，以续写指令重新发起 */
  continueFromPartial: (work: Work, messages: Message[], partial: string) => Promise<Message | null>;
  /** 换一支：同 directive 重生成，结果 push 进 target.swipes（幂等 upsert） */
  swipeRegenerate: (work: Work, messages: Message[], target: Message) => Promise<Message | null>;
  /** 本章加长/续写（用户需求）：append=从本章结尾续写新剧情（追加式变长）；expand=扩写本章（原地加厚，情节不变）。
   *  结果作为 target 的新候选版本追加（◀▶ 可回退原文），同 id 幂等覆盖 */
  extendChapter: (
    work: Work,
    messages: Message[],
    target: Message,
    mode: 'append' | 'expand',
  ) => Promise<Message | null>;
  /** App 后台生成：server 后台任务执行 + 轮询取回（切后台/锁屏安全）；分段链自动拼接 */
  generateChapterBg: (work: Work, messages: Message[], directive: string) => Promise<Message | null>;
  /** 挂载/切回恢复：未完成的后台生成链从断点继续 */
  resumeNovelBg: (work: Work) => Promise<Message | null>;
  /** 本章加长/续写——App 后台版：单 server 任务执行，结果为该章新候选 */
  extendChapterBg: (work: Work, target: Message, mode: 'append' | 'expand') => Promise<Message | null>;
  /** 一键连写：从下一章自动写到目标章节数（第一章用传入指令、后续空指令自由发挥） */
  runBatch: (work: Work, firstDirective: string) => Promise<void>;
  /** 📖按大纲生成：从下一章起按章节大纲逐章写到覆盖的最大章号（每章自动注入本章大纲要点） */
  runByOutline: (work: Work, messages: Message[], limit?: number) => Promise<void>;
  /** 批量进度（null = 空闲；CommandBar 停止按钮进度文案消费） */
  batch: BatchProgress | null;
  /** 停止当前生成与连写循环（已产出部分保留在界面，「继续」可用） */
  stop: () => void;
  /** 关闭错误提示（保留半成品供继续） */
  clearError: () => void;
  /** 上一轮生成完成入库时上下文是否发生过截断（usage.truncated，界面提示条消费） */
  lastTruncated: boolean;
  /** 关闭截断提示 */
  clearTruncated: () => void;
}

export function useGenerate(): UseGenerateResult {
  const abortRef = useRef<AbortController | null>(null);
  // 连写循环取消标志：stop() 置位（顶栏 + CommandBar 双入口收敛此处），循环轮末检查退出
  const batchCancelRef = useRef(false);
  // 上下文截断提示（store 收束即清零，generationStore 不留痕，挂 hook 本地态最小改动）
  const [lastTruncated, setLastTruncated] = useState(false);
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const clearTruncated = useCallback(() => setLastTruncated(false), []);

  // 卸载即取消连写（离开作品页不再续写后续章；已入库章节保留）
  useEffect(() => {
    return () => {
      batchCancelRef.current = true;
    };
  }, []);

  const run = useCallback(
    (work: Work, messages: Message[], directive: string, opts: RunOptions): Promise<Message | null> =>
      runGenerationStream<Message>({
        workId: work.id,
        targetId: opts.targetId,
        initialBuffer: opts.initialBuffer,
        pace: true, // novel 章节生成启用打字机逐字显示
        bindController: (c) => {
          abortRef.current = c;
        },
        prepare: async ({ prefs, startedAt }) => {
          // ---------- 组装阶段（重试不复用之外的流请求） ----------
          const { body, fitted, assets, env, pending } = await assembleGenRequest(work, messages, directive, opts, prefs);
          return {
            body,
            // ---------- 完成收尾：后处理 → 幂等入库 → 变量回写 → 记录截断 ----------
            finalize: async () => {
              const msg = await finalizeGeneration({
                work,
                messages,
                directive,
                ...(opts.keepTitle ? { keepTitle: opts.keepTitle } : {}),
                swipeTarget: opts.swipeTarget ?? null,
                assets,
                env,
                prefs,
                promptTokens: fitted.promptTokens,
                activatedIds: fitted.activatedIds,
                startedAt,
                pending,
                // 无效输出重试：落库行按首次消息 id 幂等覆盖（重试不产生重复章节行）
                ...(opts.persistMessageId ? { messageId: opts.persistMessageId } : {}),
              });
              setLastTruncated(fitted.truncated);
              return msg;
            },
          };
        },
      }),
    [],
  );

  /** 重试后缀与续写轮上限：client/server 单一事实源（server orchestrate 同文引用，2026-11-21 M2） */
  /** 无效输出判定：返回需要重试的原因——仅 finalize 成功返回的消息参与判定；
   *  run 返回 null（流中错误/用户停止/防重入）不算无效，交由上层终止/提示，绝不重试；
   *  content 非字符串（异常数据）视为正常消息，不误触发重试 */
  const invalidReasonOf = (m: Message | null): 'meta' | 'collapse' | null => {
    if (m === null) return null;
    const c = m.content;
    if (typeof c !== 'string') return null;
    if (!c.trim() || c.startsWith(META_ONLY_PLACEHOLDER)) return 'meta';
    if (isCollapsedText(c)) return 'collapse';
    return null;
  };
  const RETRY_SUFFIX: Record<'meta' | 'collapse', string> = {
    meta: META_RETRY_SUFFIX,
    collapse: COLLAPSE_RETRY_SUFFIX,
  };

  /** 截断自动续写（generateChapter/swipeRegenerate 共用）：双判据——
   *  判据统一走 looksTruncated（finish 明示 / 无 finish 帧时启发式+字数兜底——句号边界截断盲区）
   *  runOpts(partial) 由调用方给定续写轮的入库语义（普通章按消息 id 幂等覆盖 / swipe 候选更新）。
   *  续写轮接线（用户反馈③）：①半章原文以伪 assistant 消息进历史（grounding，模型知道已写什么）；
   *  ②continuation 标记切「无缝续写」要求块与守卫（不再要求「第一行输出章标题」——该指令
   *  在续写轮等于命令模型重新开章）；③新增段以章标题开头 = 模型重开 → 只保留新章（旧半章按
   *  用户预期「当它不存在」），同 id 幂等覆盖落库 */
  const continueTruncated = async (
    work: Work,
    ctxMessages: Message[],
    directive: string,
    first: Message | null,
    tw: number,
    runOpts: (partial: string) => Parameters<typeof run>[3],
  ): Promise<Message | null> => {
    let msg = first;
    const targetWords = work.settings.targetChapterWords ?? 3000;
    for (let rounds = 0; rounds < MAX_TRUNCATE_ROUNDS && msg; rounds += 1) {
      const finish = useGenerationStore.getState().finishReason;
      if (!looksTruncated(finish, msg.content, targetWords)) break;
      const prev = msg;
      const partial = msg.content;
      // 续写轮按「补完剩余字数后收束」（target − 已有）：防每轮再写满额字数导致章节膨胀（生产实测）
      const remaining = Math.max(400, targetWords - partial.length);
      const next = await run(
        work,
        withPartialInHistory(ctxMessages, partial),
        buildContinueDirective(partial),
        { ...runOpts(partial), continuation: true, continueRemaining: remaining },
      );
      // 重放保护：上游把已有内容从头复述（短流×字数兜底误判组合）→ 整体回滚本轮并停止——
      // content 之外 chapter.title/directive 也一并还原（续写轮 finalize 会把指令文本污染进
      // title 的回退路径），同 id 幂等覆盖回写
      if (next && isReplayedContinuation(partial, next.content)) {
        const rolled = { ...next, content: partial, directive: prev.directive };
        if (prev.chapter) rolled.chapter = { ...prev.chapter };
        await persistMessage(work.id, rolled);
        msg = rolled;
        break;
      }
      // 重开保护：新增段以章标题开头 = 模型无视续写纪律重新开章 → 丢弃旧半章、只保留新章
      //（parseChapterTitle 把新章标题剥进 chapter 元数据；旧 chapter.title 保留为兜底），
      // directive/章节归属还原为 prev（续写轮 finalize 会把续写指令文本污染进 title 回退路径）
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
        await persistMessage(work.id, rolled);
        msg = rolled;
        break;
      }
      // 正常续写：chapter/directive 同样还原为 prev（章节身份不变；title 不被续写指令污染）
      msg = next
        ? { ...next, directive: prev.directive, ...(prev.chapter ? { chapter: { ...prev.chapter } } : {}) }
        : next;
    }
    return msg;
  };

  /** 流中断自动恢复：run 返回 null（网络/上游错误中断，非用户停止）且已有部分内容时，
   *  以缓冲区半成品为基底自动续写一轮——此前中断即整体丢弃出库，几千字白写（根因③）。
   *  同样走续写轮语义：半章进历史 grounding + continuation 要求块（防重开）。 */
  const rescueFromStreamBreak = async (
    work: Work,
    messages: Message[],
    directive: string,
    targetId: string,
  ): Promise<Message | null> => {
    const st = useGenerationStore.getState();
    if (st.error === null || !st.partialKept || st.buffer.trim().length < 200) return null; // 用户停止/无实质内容 → 不救
    return run(work, withPartialInHistory(messages, st.buffer), buildContinueDirective(st.buffer), {
      targetId,
      initialBuffer: st.buffer,
      promptDirective: directive,
      maxTokensScale: 2,
      continuation: true,
    });
  };

  const generateChapter = useCallback(
    async (work: Work, messages: Message[], directive: string) => {
      // 重试复用同一 targetId：入库按 messageId 幂等 upsert，重试结果覆盖首次无效行
      //（否则首次残章/崩溃行以孤儿形式留在库里，重载后出现垃圾章节）
      const targetId = uuid();
      const tw = work.settings.targetChapterWords ?? 3000;
      // 长章主动分段（用户需求：单段 20 分钟太长、撞超时上限）——每段约 SEGMENT_WORDS 字，
      // 段间以续写语义自动拼接（要求块按段改字数/停笔纪律）；每段独立请求：撞超时/断流只损当段，
      // 已落库段落不丢（各段按 targetId 幂等覆盖累积）
      const parts = Math.max(1, Math.ceil(tw / SEGMENT_WORDS));
      const thinkingOn = useSettingsStore.getState().llmPrefs.thinking !== false;
      const segmentBudget = calcOutputBudget(SEGMENT_WORDS + 600, thinkingOn, 1);
      let msg: Message | null;
      if (parts > 1) {
        // 第 1 段：段级预算（写满即停，后续段自动续写）+ 分段要求块（非末段不收尾）
        msg = await run(work, messages, directive, {
          targetId,
          initialBuffer: '',
          segment: { part: 1, parts, words: SEGMENT_WORDS },
          effMaxTokensOverride: segmentBudget,
        });
        if (msg === null) msg = await rescueFromStreamBreak(work, messages, directive, targetId);
      } else {
        msg = await run(work, messages, directive, { targetId, initialBuffer: '' });
        if (msg === null) msg = await rescueFromStreamBreak(work, messages, directive, targetId);
      }
      const reason = invalidReasonOf(msg);
      if (msg && reason) {
        // 残章/重复循环：带专用重试后缀再来一次（后缀只进提示词；落库按首次消息 id 幂等覆盖）。
        // meta 的本质常是「思考吃满输出预算」——重试同时把预算提到 3 倍（封顶 64000），只换提示词注定再失败
        msg = await run(work, messages, directive, {
          targetId,
          initialBuffer: '',
          promptDirective: directive + RETRY_SUFFIX[reason],
          persistMessageId: msg.id,
          maxTokensScale: 3,
          ...(parts > 1 ? { segment: { part: 1, parts, words: SEGMENT_WORDS } } : {}),
        });
      }
      if (parts > 1) {
        // 第 2..parts 段：续写语义（无缝续写要求块 + 半章进历史 grounding），
        // finish=stop 尊重模型提前收束；重放/重开检测与元数据还原同 continueTruncated
        for (let part = 2; part <= parts && msg; part += 1) {
          const finish = useGenerationStore.getState().finishReason;
          if (finish === 'stop') break; // 模型自然收束 → 分段链提前完成
          const prev = msg;
          const partial = msg.content;
          const next = await run(work, withPartialInHistory(messages, partial), buildContinueDirective(partial), {
            targetId,
            initialBuffer: partial,
            promptDirective: directive,
            persistMessageId: prev.id, // 当前累积行 id（run1 由 finalize 生成 uuid）
            continuation: true,
            segment: { part, parts, words: SEGMENT_WORDS },
            effMaxTokensOverride: segmentBudget,
            maxTokensScale: 1,
          });
          if (next && isReplayedContinuation(partial, next.content)) {
            const rolled = { ...next, content: partial, directive: prev.directive };
            if (prev.chapter) rolled.chapter = { ...prev.chapter };
            await persistMessage(work.id, rolled);
            msg = rolled;
            break;
          }
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
            await persistMessage(work.id, rolled);
            msg = rolled;
            break;
          }
          msg = next
            ? { ...next, directive: prev.directive, ...(prev.chapter ? { chapter: { ...prev.chapter } } : {}) }
            : next;
        }
      } else {
        // 截断自动续写（补完结果同 id 幂等覆盖；腰斩常因思考挤占预算——续写轮抬预算 2 倍）。
        // 传 tw/原章标题：续写轮按「补完剩余字数后收束」改写字数行（防章节越来越长，生产实测）
        const baseId = msg?.id ?? targetId;
        const keepTitle = msg?.chapter?.title;
        msg = await continueTruncated(work, messages, directive, msg, tw, (partial) => ({
          targetId,
          initialBuffer: partial,
          promptDirective: directive,
          persistMessageId: baseId,
          keepTitle,
          continueRemaining: Math.max(400, tw - partial.length),
          maxTokensScale: 2,
        }));
      }
      // 润色模型 pass（P2-2）：设置 polishModel 后用第二模型对全文润色（保持情节/事实/字数），
      // 同 id 幂等覆盖落库行；润色失败静默保留原稿（正文本身已可用）。
      // 仅对有效产出润色——meta 占位/崩溃循环稿润色无意义，白烧一次调用（巡检修复）
      const polishModel = useSettingsStore.getState().llmPrefs.polishModel;
      const polishable = msg !== null && invalidReasonOf(msg) === null && Boolean(polishModel);
      if (polishable) {
        try {
          const res = await apiFetch<{ text?: string }>('/api/llm/generate', {
            method: 'POST',
            body: JSON.stringify({
              source: useSettingsStore.getState().llmPrefs.source,
              model: polishModel,
              stream: false,
              params: { temperature: 0.6 },
              messages: [
                {
                  role: 'system',
                  content:
                    '你是资深小说编辑。对下面的章节全文做语言润色：保持全部情节、对话与事实，字数变化不超过 10%；' +
                    '提升语言质感、消除重复与平庸表达；不改变人称与叙事结构。只输出润色后的正文本身，禁止任何解释或元信息。',
                },
                { role: 'user', content: msg!.content },
              ],
            }),
          });
          const polished = res.text?.trim();
          if (polished && msg) {
            // 润色稿写回激活版本（新消息仅一支候选，等价旧 [polished] 重置语义）
            const activeId = msg.swipeId;
            msg = {
              ...msg,
              content: polished,
              swipes: msg.swipes.map((v, i) => (i === activeId ? { ...v, content: polished } : v)),
            };
            await persistMessage(work.id, msg); // 同 id 幂等覆盖：落库行更新为润色稿
          }
        } catch {
          // 润色失败保留原稿（静默——正文本身已可用）
        }
      }
      // 最后防线（巡检修复：必须对有效产出标记，且在润色之后——润色生成新版本时标记跟随最终版本；
      // meta 占位/崩溃循环稿不标：它们有自己的占位/重试语义，且 swipe 场景占位已 append 进 swipes，
      // 误标会指向崩溃候选）。入库 extra.truncatedSwipeId（版本级标记，UI 必显「未写完」提示——
      // 不依赖启发式，截断恰好落在句号边界时 isTruncatedText 漏检，此类残章此前无声入库）
      if (msg && invalidReasonOf(msg) === null) {
        const finish = useGenerationStore.getState().finishReason;
        const tw = work.settings.targetChapterWords ?? 3000;
        if (looksTruncated(finish, msg.content, tw)) {
          msg = { ...msg, extra: { ...msg.extra, truncatedSwipeId: msg.swipeId } };
          try {
            await persistMessage(work.id, msg);
          } catch {
            /* 标记落库失败不阻塞返回 */
          }
        }
      }
      // 重试一次后仍无效（或本次即失败）：返回 null——调用方不上架（batch 以 null 终止）；
      // 库中该 id 行已被末次输出覆盖，不产生重复章节行
      return invalidReasonOf(msg) ? null : msg;
    },
    [run],
  );

  const continueFromPartial = useCallback(
    (work: Work, messages: Message[], partial: string) => {
      const targetId = useGenerationStore.getState().targetMessageId ?? uuid();
      // 续写轮语义（反馈③）：半章进历史 grounding + continuation 要求块（不要求章标题、禁止重开）
      return run(work, withPartialInHistory(messages, partial), buildContinueDirective(partial), {
        targetId,
        initialBuffer: partial,
        continuation: true,
      });
    },
    [run],
  );

  const swipeRegenerate = useCallback(
    async (work: Work, messages: Message[], target: Message) => {
      if (target.swipes.length >= MAX_SWIPES) {
        useGenerationStore.getState().fail(swipeLimitError(), false);
        return Promise.resolve(null);
      }
      // 对齐 chat 语义：上下文取 target 之前（被重roll章节的旧候选不进上下文）
      const directive = target.directive ?? '';
      const ctx = historyBeforeTarget(messages, target.id);
      let msg = await run(work, ctx, directive, {
        targetId: target.id,
        initialBuffer: '',
        swipeTarget: target,
      });
      const reason = invalidReasonOf(msg);
      if (msg && reason) {
        msg = await run(work, ctx, directive, {
          targetId: target.id,
          initialBuffer: '',
          swipeTarget: target,
          promptDirective: directive + RETRY_SUFFIX[reason], // 后缀只进提示词，不入库 metadata
        });
      }
      // 重roll 同样走截断自动续写（与 generateChapter 同判据同轮数；候选经 swipeTarget 更新落库）
      const keepTitle = target.chapter?.title;
      msg = await continueTruncated(
        work,
        ctx,
        directive,
        msg,
        work.settings.targetChapterWords ?? 3000,
        (partial) => ({
          targetId: target.id,
          initialBuffer: partial,
          swipeTarget: target,
          promptDirective: directive,
          keepTitle,
          continueRemaining: Math.max(400, (work.settings.targetChapterWords ?? 3000) - partial.length),
          maxTokensScale: 2,
        }),
      );
      // 最后防线同 generateChapter：仅对有效产出标记（占位崩溃稿已 append 进 swipes，误标会
      // 指向崩溃候选导致提示条误显），新候选位于末位 swipe
      if (msg && invalidReasonOf(msg) === null) {
        const finish = useGenerationStore.getState().finishReason;
        const tw = work.settings.targetChapterWords ?? 3000;
        if (looksTruncated(finish, msg.content, tw)) {
          msg = { ...msg, extra: { ...msg.extra, truncatedSwipeId: msg.swipes.length - 1 } };
          try {
            await persistMessage(work.id, msg);
          } catch {
            /* 标记落库失败不阻塞返回 */
          }
        }
      }
      // 重试一次后仍无效（或本次即失败）：返回 null，保留原候选不动（占位内容不进 swipes）
      return invalidReasonOf(msg) ? null : msg;
    },
    [run],
  );

  /**
   * 分段链驱动（App 后台生成内核，可重入）：state.part 起逐段提交 server 后台任务
   * （切后台/锁屏安全——任务在 server 端继续执行，三级稳定性防线同样生效），
   * 每段完成即时按消息 id 幂等覆盖累积落库（中断只损当段）；段间以续写语义衔接
   * （无缝续写要求块 + 半章进历史 grounding），重放检测回滚累积文本。
   * UI 一致性：每段结果写进 generation store buffer（打字机视图展示累积全文）。
   */
  const driveNovelBgChain = useCallback(
    async (work: Work, messages: Message[], state: NovelBgPending): Promise<Message | null> => {
      const prefs = useSettingsStore.getState().llmPrefs;
      const slot = `novel-gen-${work.id}`;
      const segmentBudget = calcOutputBudget(SEGMENT_WORDS + 600, prefs.thinking !== false, 1);
      // 累积正文来源：库中 targetId 行（断点续跑；段 1 完成即以该 id 落库）
      const store = useWorkStore.getState();
      const row = store.messages.find((m) => m.id === state.targetId);
      let accumulated = row?.content ?? '';
      let msg: Message | null = row ?? null;
      useGenerationStore.getState().start(work.id, state.targetId, accumulated);
      try {
        for (let part = state.part; part <= state.parts; part += 1) {
          const isContinue = part > 1;
          const seg = state.parts > 1 ? { part, parts: state.parts, words: SEGMENT_WORDS } : undefined;
          const ctx = isContinue ? withPartialInHistory(messages, accumulated) : messages;
          const { body, fitted, assets, env, pending } = await assembleGenRequest(
            work,
            ctx,
            state.directive,
            {
              initialBuffer: accumulated,
              promptDirective: isContinue ? buildContinueDirective(accumulated) : state.directive,
              continuation: isContinue,
              segment: seg,
              effMaxTokensOverride: state.parts > 1 ? segmentBudget : undefined,
              persistMessageId: isContinue ? (row?.id ?? state.targetId) : undefined,
            },
            prefs,
          );
          await submitTask(slot, {
            source: prefs.source,
            model: prefs.model,
            messages: body.messages as never,
            params: body.params as unknown as Record<string, unknown>,
            thinking: prefs.thinking !== false,
            label: '章节生成',
          });
          const raw = await waitAndStore(slot);
          // 结果写进 generation store buffer（finalizeGeneration 从 store 读原文；打字机视图展示累积全文）。
          // 不调 reset()：reset 会清空 buffer 让「正在看的内容」瞬间消失（用户实测感知为截断），
          // start(initialBuffer=累积) 本身即完成 buffer 重置
          useGenerationStore.getState().start(work.id, state.targetId, accumulated);
          useGenerationStore.getState().appendChunk(raw);
          const roundDirective = isContinue ? buildContinueDirective(accumulated) : state.directive;
          msg = await finalizeGeneration({
            work,
            messages: ctx,
            directive: roundDirective,
            swipeTarget: null,
            assets,
            env,
            prefs,
            promptTokens: fitted.promptTokens,
            activatedIds: fitted.activatedIds,
            startedAt: Date.now(),
            pending,
            messageId: isContinue ? (row?.id ?? state.targetId) : undefined,
          });
          if (!msg) break;
          if (isContinue && isReplayedContinuation(accumulated, msg.content)) {
            // 上游重放（改写式重述前文）：回滚为累积文本，链结束（已写部分完好）
            msg = { ...msg, content: accumulated };
            await persistMessage(work.id, msg);
            break;
          }
          // 续写段 title 还原（生产实证污染：续写输出无标题行时 parseChapterTitle 用
          // 续写指令首句兜底 → title=「接着写完这一章：…」）——无标题行的段沿用基准标题
          if (isContinue && msg.chapter && (!msg.chapter.title.trim() || msg.chapter.title.startsWith('接着写完这一章'))) {
            const baseTitle = row?.chapter?.title ?? msg.chapter.title;
            msg = { ...msg, chapter: { ...msg.chapter, title: baseTitle } };
          }
          accumulated = msg.content;
          localStorage.setItem(novelBgPendingKey(work.id), JSON.stringify({ ...state, part: part + 1 }));
        }
      } catch (err) {
        const ge = toGenerationError(err);
        useGenerationStore.getState().fail(ge, accumulated.length > 0);
      } finally {
        useGenerationStore.getState().finish();
        useGenerationStore.getState().reset();
        localStorage.removeItem(novelBgPendingKey(work.id));
      }
      return invalidReasonOf(msg) ? null : msg;
    },
    [],
  );

  /**
   * App 后台生成（用户需求②：切后台/锁屏不再「流式连接中断」白跑）：
   * 生成交由 server 后台任务执行，客户端轮询取回；分段链同前台语义（每段独立任务，
   * 完成即落库）。返回入库消息（失败/部分完成返回 null，已落库段落保留在作品里）。
   */
  const generateChapterBg = useCallback(
    async (work: Work, messages: Message[], directive: string): Promise<Message | null> => {
      if (useGenerationStore.getState().streaming) return null;
      const prefs = useSettingsStore.getState().llmPrefs;
      if (!prefs.model) {
        useGenerationStore.getState().fail({ code: 'LLM_NOMODEL', message: '请先在设置页选择模型' }, false);
        return null;
      }
      const tw = work.settings.targetChapterWords ?? 3000;
      const parts = Math.max(1, Math.ceil(tw / SEGMENT_WORDS));
      const state: NovelBgPending = { directive, targetId: uuid(), part: 1, parts };
      localStorage.setItem(novelBgPendingKey(work.id), JSON.stringify(state));
      return driveNovelBgChain(work, messages, state);
    },
    [driveNovelBgChain],
  );

  /** 挂载/切回恢复：有未完成的后台生成链（PENDING + slot）时从断点继续剩余段 */
  const resumeNovelBg = useCallback(
    async (work: Work): Promise<Message | null> => {
      const state = readNovelBgPending(work.id);
      if (!state) return null;
      const slot = `novel-gen-${work.id}`;
      // 链已无在跑任务也无待取结果（如任务过期丢失）→ 清 PENDING，提示层由调用方按 null 处理
      if (!taskPending(slot) && peekResult(slot) === null && consumeResult(slot) === null) {
        localStorage.removeItem(novelBgPendingKey(work.id));
        return null;
      }
      return driveNovelBgChain(work, useWorkStore.getState().messages, state);
    },
    [driveNovelBgChain],
  );

  /**
   * 本章加长/续写（用户需求：卷章之外允许对当前章要求加长或续写）：
   * - append（续写本章）：上下文含本章（末条）→ continuation 语义从本章结尾续写新剧情；
   *   initialBuffer=章全文 → buffer 流式呈现「旧文+新文」，结果为完整扩展文本
   * - expand（加长本章）：扩写语义，基于当前版本输出更长完整章（情节不变原地加厚），initialBuffer=''
   * 两者都经 swipeTarget 通道：新内容成为 target 的新候选版本（◀▶ 可回退原文），同 id 幂等覆盖；
   * 产出后同走截断自动续写（append 续写轮语义 / expand 常规语义）
   */
  const extendChapter = useCallback(
    async (work: Work, messages: Message[], target: Message, mode: 'append' | 'expand') => {
      if (useGenerationStore.getState().streaming) return null; // 防重入
      const idx = messages.findIndex((m) => m.id === target.id);
      // 上下文含本章（含 target 本体，模型看得到要续写/扩写的正文）；其后章节不进上下文
      const ctx = idx === -1 ? messages : messages.slice(0, idx + 1);
      const tw = work.settings.targetChapterWords ?? 3000;
      // 加长目标字数（用户实测：对已超目标的章「扩写到 tw」语义矛盾 → 模型原地重写感知为没变化）：
      // 目标 = max(作品目标字数, 现有字数 + 1500)——「加长」必须比现在更长
      const expandTarget = Math.max(tw, target.content.length + 1500);
      const directive =
        mode === 'append'
          ? buildContinueDirective(target.content)
          : `把本章加长扩写（保持情节不变，写到约 ${expandTarget} 字）`;
      let msg = await run(work, ctx, directive, {
        targetId: target.id,
        initialBuffer: mode === 'append' ? target.content : '',
        swipeTarget: target,
        // 扩写轮关思考（生产实测：推理模型思考吞掉输出预算 → meta 空产出静默失败）
        ...(mode === 'append' ? { continuation: true } : { expandChapter: true, thinkingOff: true }),
        maxTokensScale: 2, // 扩写/续写都是长输出：预算 2 倍（封顶 64000）
      });
      const reason = invalidReasonOf(msg);
      if (msg && reason) {
        msg = await run(work, ctx, directive, {
          targetId: target.id,
          initialBuffer: mode === 'append' ? target.content : '',
          swipeTarget: target,
          ...(mode === 'append' ? { continuation: true } : { expandChapter: true, thinkingOff: true }),
          promptDirective: directive + RETRY_SUFFIX[reason],
          maxTokensScale: 3,
        });
      }
      // 截断自动续写：append 走续写轮语义（无缝续写），expand 走常规语义（finish=length 时补写）
      msg = await continueTruncated(
        work,
        ctx,
        directive,
        msg,
        work.settings.targetChapterWords ?? 3000,
        (partial) => ({
          targetId: target.id,
          initialBuffer: partial,
          swipeTarget: target,
          ...(mode === 'append' ? { continuation: true } : {}),
          maxTokensScale: 2,
        }),
      );
      return invalidReasonOf(msg) ? null : msg;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, continueTruncated],
  );

  /**
   * 本章加长/续写——App 后台版（2026-11-19：移动端/App 场景，切后台安全）：
   * 单个 server 后台任务执行（assembleGenRequest 同一组装通路），完成经 swipeTarget
   * 通道追加为该章新候选版本（◀▶ 可回退原文）。无分段链：单任务直达，语义与 extendChapter 相同。
   */
  const extendChapterBg = useCallback(
    async (work: Work, target: Message, mode: 'append' | 'expand'): Promise<Message | null> => {
      if (useGenerationStore.getState().streaming) return null;
      const prefs = useSettingsStore.getState().llmPrefs;
      const slot = `novel-gen-${work.id}`;
      const tw = work.settings.targetChapterWords ?? 3000;
      const isAppend = mode === 'append';
      const store = useWorkStore.getState();
      const idx = store.messages.findIndex((m) => m.id === target.id);
      const ctx = idx === -1 ? store.messages : store.messages.slice(0, idx + 1);
      // 加长目标字数：max(作品目标, 现有字数 + 1500)——与 extendChapter 同语义（「加长」必须比现在更长）
      const expandTarget = Math.max(tw, target.content.length + 1500);
      const { body, fitted, assets, env, pending } = await assembleGenRequest(
        work,
        ctx,
        '',
        {
          initialBuffer: isAppend ? target.content : '',
          promptDirective: isAppend
            ? buildContinueDirective(target.content)
            : `把本章加长扩写（保持情节不变，写到约 ${expandTarget} 字）`,
          continuation: isAppend,
          expandChapter: !isAppend,
          thinkingOff: !isAppend, // 扩写轮关思考（生产实测思考吞预算 → meta 空产出）
          maxTokensScale: 2,
          swipeTarget: target,
        },
        prefs,
      );
      useGenerationStore.getState().start(work.id, target.id, isAppend ? target.content : '');
      await submitTask(slot, {
        source: prefs.source,
        model: prefs.model,
        messages: body.messages as never,
        params: body.params as unknown as Record<string, unknown>,
        thinking: prefs.thinking !== false,
        label: isAppend ? '本章续写' : '本章加长',
      });
      const raw = await waitAndStore(slot);
      useGenerationStore.getState().appendChunk(raw);
      const msg = await finalizeGeneration({
        work,
        messages: ctx,
        directive: target.directive ?? '',
        swipeTarget: target,
        assets,
        env,
        prefs,
        promptTokens: fitted.promptTokens,
        activatedIds: fitted.activatedIds,
        startedAt: Date.now(),
        pending,
      });
      useGenerationStore.getState().finish();
      useGenerationStore.getState().reset();
      return invalidReasonOf(msg) ? null : msg;
    },
    [],
  );

  const stop = useCallback(() => {
    batchCancelRef.current = true; // 连写循环下一轮检查后退出
    abortRef.current?.abort();
  }, []);

  /** 一键连写：从下一章自动写到目标章节数（循环编排在 generation-batch.runChunkLoop） */
  const runBatch = useCallback(
    (work: Work, firstDirective: string): Promise<void> =>
      runChunkLoop(work, firstDirective, generateChapter, batchCancelRef, setBatch),
    [generateChapter],
  );

  /** 📖按大纲生成（反馈⑤）：从下一章起按 chapterOutlines 逐章写到覆盖的最大章号
   *  （循环编排在 generation-batch.runOutlineLoop；每章 directive 固定「按本章大纲写」，
   *  本章要点由 scanAndAssemble 按章号自动注入）。limit：本次最多写几章（用户可选「先写 N 章」） */
  const runByOutline = useCallback(
    (work: Work, messages: Message[], limit?: number): Promise<void> =>
      runOutlineLoop(work, messages, generateChapter, batchCancelRef, setBatch, limit),
    [generateChapter],
  );

  const clearError = useCallback(() => useGenerationStore.getState().clearError(), []);

  return {
    streaming: useGenerationStore((s) => s.streaming),
    /** 正在生成的作品 id（全局单槽：跨书访问时 UI 据此区分「本书在写」与「别书在写」） */
    streamingWorkId: useGenerationStore((s) => s.workId),
    buffer: useGenerationStore((s) => s.buffer),
    thinkingBuffer: useGenerationStore((s) => s.thinkingBuffer),
    error: useGenerationStore((s) => s.error),
    partialKept: useGenerationStore((s) => s.partialKept),
    targetMessageId: useGenerationStore((s) => s.targetMessageId),
    generateChapter,
    continueFromPartial,
    swipeRegenerate,
    extendChapter,
    extendChapterBg,
    generateChapterBg,
    resumeNovelBg,
    runBatch,
    runByOutline,
    batch,
    stop,
    clearError,
    lastTruncated,
    clearTruncated,
  };
}
