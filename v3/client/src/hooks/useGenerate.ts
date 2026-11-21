/**
 * 生成流 hook（novel 语义，设计 §3.2 数据流 / §9.1 重试 / §9.2 生成事务性）
 *
 * generateChapter：组装（directive 通道：拉绑定资产 → 世界书扫描 → 总装 → tokenize 校验）
 *   → POST /api/llm/generate SSE → 逐 chunk 进 generationStore
 *   → 完成后处理（正则/标题/状态块）→ 构造 Message 幂等入库
 * continueFromPartial：断流半成品 +「继续」= mode=continue 任务（半成品作 server 续写基底）
 * swipeRegenerate：同 directive 重生成（mode=swipe 任务），server 做 historyBeforeTarget
 *   上下文 + appendSwipe 候选追加（MAX_SWIPES 双层：客户端预检省往返，server 权威拒绝）
 * M2 Chunk 5 任务化：全部生成操作统一提交 server novel-chapter 任务（四模式），
 * 编排（分段/重试/截断续写/润色）在 server services/novel-gen；旧 client SSE 生成链
 * 仅作过渡保留（Chunk 5.2 删除）。
 */
import { useCallback, useRef, useState } from 'react';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

import { buildGenerateBody, cachedOutputBudget, type GenerateBody } from '../api/llm';
import { isCollapsedText } from '../engine/prompt/novel/collapse-detect';
import { getGenSlot, selectStreamingWorkId, useGenSlot, useGenSlots, useGenerationStore } from '../stores/generation';
import { useSettingsStore, type LlmPrefs } from '../stores/settings';
import { useWorkStore } from '../stores/work';
import { NOVEL_CHAPTERS_MAX, consumeResult, peekResult, submitTask, taskPending, waitAndStore } from '../lib/llmTask';
import { notifyDone, showToast } from '../lib/toast';

import {
  MAX_SWIPES,
  OUTLINE_DIRECTIVE,
  buildContinueDirective,
  toGenerationError,
  calcOutputBudget,
  historyBeforeTarget,
  isChapterRestart,
  isReplayedContinuation,
  looksTruncated,
  nextChapterIndex,
  outlineRunPlan,
  remainingChapters,
  swipeLimitError,
  withPartialInHistory,
  type BatchProgress,
} from './generation-flow';
import { COLLAPSE_RETRY_SUFFIX, MAX_TRUNCATE_ROUNDS, META_RETRY_SUFFIX } from '@shared/hooks/novel-constants';
import { persistMessage } from './generation-pipeline';
import { useNovelTask } from './useNovelTask';
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
  /** 本书槽位是否生成中（多槽化：其他书生成中不再阻塞本书操作；workId 未绑定时=任一槽） */
  streaming: boolean;
  /** 任一 streaming 槽的作品 id（null=无任何生成；兼容旧全局语义：书架/移动端标出「哪本在写」） */
  streamingWorkId: string | null;
  /** 存在非本书的 streaming 槽（「其他书生成中」派生语义——plan Chunk 4 多槽替代） */
  otherStreaming: boolean;
  /** 本书槽位的流式缓冲 */
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

/**
 * @param workId 绑定本书槽位（WorkPage/MobileWork 传路由 id）：返回的 streaming/buffer/error 等
 *   均读本书槽；未绑定（测试/特殊场景）时 streaming 回退「任一槽」语义，其余字段读不到槽为空。
 */
export function useGenerate(workId?: string | null): UseGenerateResult {
  const abortRef = useRef<AbortController | null>(null);
  // novel-chapter 后台任务编排（M2 Chunk 4：generateChapter/runBatch/runByOutline 走任务；
  // 挂载恢复轮询、stop 取消都收敛在此）。swipe/extend/continue 仍走 client SSE 链（Chunk 5 切）。
  const novel = useNovelTask(workId);
  // 上下文截断提示（store 收束即清零，generationStore 不留痕，挂 hook 本地态最小改动）
  const [lastTruncated, setLastTruncated] = useState(false);
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const clearTruncated = useCallback(() => setLastTruncated(false), []);

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
      const finish = getGenSlot(work.id)?.finishReason ?? null;
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

  /**
   * 章节生成（2026-11-21 M2 Chunk 4 切换 server novel-chapter 任务）：
   * 分段/无效输出重试/截断自动续写/润色 pass/truncatedSwipeId 标记全部在 server 编排
   * （与 client 旧链逐点对齐移植，见 services/novel-gen）；客户端提交任务 + 增量回流
   * （progressText → appendChunk 打字机视图）+ 终态按 resultMessageIds 同步本地视图。
   */
  const generateChapter = useCallback(
    async (work: Work, _messages: Message[], directive: string) => {
      const outcome = await novel.submitAndWait({ work, mode: 'chapter', directive, chapters: 1 });
      return outcome.messages.at(-1) ?? null;
    },
    [novel],
  );

  /**
   * 断流后「继续」（M2 Chunk 5 切任务，mode=continue）：半成品作 server 续写基底
   * （buildContinueDirective + 半章进历史 grounding 的续写轮语义在 server 编排）；
   * 终态按 resultMessageIds 取回入库消息（同 id 幂等覆盖语义 server 侧完成）。
   */
  const continueFromPartial = useCallback(
    async (work: Work, _messages: Message[], partial: string) => {
      const outcome = await novel.submitAndWait({ work, mode: 'continue', directive: '', partial });
      return outcome.messages.at(-1) ?? null;
    },
    [novel],
  );

  /**
   * 换一支（M2 Chunk 5 切任务，mode=swipe）：server 端 historyBeforeTarget 上下文
   * （被重roll章节的旧候选不进上下文）+ 无效输出重试 + 截断自动续写 + appendSwipe
   * 候选追加；终态取回更新后的 target 消息（新候选位于末位 swipe）。MAX_SWIPES 双层：
   * 客户端预检省一次往返，server 权威拒绝（同书任务互斥外仍兜底并发竞态）。
   */
  const swipeRegenerate = useCallback(
    async (work: Work, _messages: Message[], target: Message) => {
      if (target.swipes.length >= MAX_SWIPES) {
        useGenerationStore.getState().fail(work.id, swipeLimitError(), false);
        return null;
      }
      const outcome = await novel.submitAndWait({
        work,
        mode: 'swipe',
        directive: target.directive ?? '',
        targetId: target.id,
      });
      return outcome.messages.at(-1) ?? null;
    },
    [novel],
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
          useGenerationStore.getState().appendChunk(work.id, raw);
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
        useGenerationStore.getState().fail(work.id, ge, accumulated.length > 0);
      } finally {
        useGenerationStore.getState().finish(work.id);
        useGenerationStore.getState().reset(work.id);
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
      if (useGenerationStore.getState().slots[work.id]?.streaming) return null;
      const prefs = useSettingsStore.getState().llmPrefs;
      if (!prefs.model) {
        useGenerationStore.getState().fail(work.id, { code: 'LLM_NOMODEL', message: '请先在设置页选择模型' }, false);
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
   * 本章加长/续写（M2 Chunk 5 切任务，mode=append|expand，用户需求：卷章之外允许对当前章
   * 要求加长或续写）：append=从本章结尾续写新剧情（追加式变长）/ expand=扩写本章（原地加厚），
   * 上下文含本章、扩写轮关思考、maxTokensScale 2 等语义在 server 逐点对齐移植（runExtendMode）；
   * 新候选版本追加（◀▶ 可回退原文）经 server appendSwipe，同 id 幂等覆盖；per-work 防重入
   * 由任务提交层（useNovelTask）承担。
   */
  const extendChapter = useCallback(
    async (work: Work, _messages: Message[], target: Message, mode: 'append' | 'expand') => {
      const outcome = await novel.submitAndWait({ work, mode, directive: '', targetId: target.id });
      return outcome.messages.at(-1) ?? null;
    },
    [novel],
  );

  /**
   * 本章加长/续写——App 后台版（2026-11-19：移动端/App 场景，切后台安全）：
   * 单个 server 后台任务执行（assembleGenRequest 同一组装通路），完成经 swipeTarget
   * 通道追加为该章新候选版本（◀▶ 可回退原文）。无分段链：单任务直达，语义与 extendChapter 相同。
   */
  const extendChapterBg = useCallback(
    async (work: Work, target: Message, mode: 'append' | 'expand'): Promise<Message | null> => {
      if (useGenerationStore.getState().slots[work.id]?.streaming) return null;
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
      useGenerationStore.getState().appendChunk(work.id, raw);
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
      useGenerationStore.getState().finish(work.id);
      useGenerationStore.getState().reset(work.id);
      return invalidReasonOf(msg) ? null : msg;
    },
    [],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort(); // SSE 链（swipe/extend/continue）停止
    novel.stop(); // novel-chapter 任务：POST cancel + 槽 fail(null, partialKept)（D6：当前段跑完即停，已入库保留）
  }, [novel]);

  /**
   * 一键连写（M2 Chunk 4 切任务）：提交 chapters=剩余章数（≤NOVEL_CHAPTERS_MAX，server 端
   * 按 BATCH_CHUNK_SIZE 批次屏障分批——长批次质量防线在 server 保留）→ 轮询 done 计数驱动
   * setBatch 进度 → 终态按 resultMessageIds 同步本地视图 + 汇总 toast（文案沿用旧循环语义）。
   */
  const runBatch = useCallback(
    async (work: Work, firstDirective: string): Promise<void> => {
      const total = work.settings.desiredChapterCount;
      const current = useWorkStore.getState().messages;
      const remaining = remainingChapters(current, total);
      if (remaining <= 0) return; // 已达目标：零请求
      if (getGenSlot(work.id)?.streaming) return; // 防重入（本书生成中不可发起连写）
      const baseIndex = nextChapterIndex(current) - 1;
      const chapters = Math.min(remaining, NOVEL_CHAPTERS_MAX);
      setBatch({ done: baseIndex, total, mode: 'chunk' });
      try {
        const outcome = await novel.submitAndWait({
          work,
          mode: 'chapter',
          directive: firstDirective,
          chapters,
          onProgress: (p) => setBatch({ done: baseIndex + p.done, total, mode: 'chunk' }),
        });
        const completed = outcome.messages
          .map((m) => m.chapter?.index ?? 0)
          .filter((n) => n > 0)
          .sort((a, b) => a - b);
        if (completed.length === 0) return; // 全部失败：error 已进槽提示，无汇总
        const left = remainingChapters(useWorkStore.getState().messages, total);
        if (outcome.stopped) {
          showToast(`⏹ 连写已停止——本次完成 ${completed.length} 章（第${completed.join('、第')}章），点「继续」可接着写`, { duration: 6000 });
        } else if (left > 0) {
          showToast(`本批 ${completed.length} 章完成（第${completed.join('、第')}章）——还剩 ${left} 章，再点「一键连写」继续`, { duration: 6000 });
        } else {
          notifyDone(`🎉 全书连写完成！目标 ${total} 章全部到位`, { duration: 6000 });
        }
      } finally {
        setBatch(null);
      }
    },
    [novel],
  );

  /**
   * 📖按大纲生成（反馈⑤，M2 Chunk 4 切任务）：提交 chapters=大纲剩余覆盖章数（outline=true
   * 走 server 大纲链，本章要点由 server 组装按章号自动注入）→ 轮询进度驱动 setBatch →
   * 终态同步 + 汇总 toast（文案沿用旧循环语义）。limit：本次最多写几章（用户可选「先写 N 章」）。
   */
  const runByOutline = useCallback(
    async (work: Work, messages: Message[], limit?: number): Promise<void> => {
      const plan = outlineRunPlan(messages, work.settings.chapterOutlines);
      if (!plan) return; // 无大纲/已覆盖完：按钮不应出现，防御兜底
      if (getGenSlot(work.id)?.streaming) return; // 防重入
      const chapters = Math.min(limit && limit > 0 ? Math.min(plan.total, limit) : plan.total, NOVEL_CHAPTERS_MAX);
      setBatch({ done: 0, total: chapters, mode: 'outline' });
      try {
        const outcome = await novel.submitAndWait({
          work,
          mode: 'chapter',
          directive: OUTLINE_DIRECTIVE,
          chapters,
          outline: true,
          onProgress: (p) => setBatch({ done: p.done, total: chapters, mode: 'outline' }),
        });
        const completed = outcome.messages
          .map((m) => m.chapter?.index ?? 0)
          .filter((n) => n > 0)
          .sort((a, b) => a - b);
        if (completed.length === 0) return;
        const left = outlineRunPlan(useWorkStore.getState().messages, work.settings.chapterOutlines);
        if (left && left.total > 0) {
          showToast(`本批按大纲完成 ${completed.length} 章（第${completed.join('、第')}章）——大纲还剩 ${left.total} 章`, { duration: 6000 });
        } else {
          notifyDone(`🎉 按大纲生成全部完成（${completed.length} 章）！`, { duration: 6000 });
        }
      } finally {
        setBatch(null);
      }
    },
    [novel],
  );

  const clearError = useCallback(() => {
    if (workId) useGenerationStore.getState().clearError(workId);
  }, [workId]);

  // 多槽化（M2 Chunk 4）：返回面按本书槽位派生（workId 绑定时）；streamingWorkId 保留
  // 「任一本在写」全局语义（书架/移动端标出「哪本在写」），本书状态看 streaming。
  const slot = useGenSlot(workId);
  const slots = useGenSlots();
  const streamingWorkId = useGenerationStore(selectStreamingWorkId);
  const otherStreaming = useGenerationStore((s) =>
    workId ? Object.keys(s.slots).some((k) => k !== workId && s.slots[k].streaming) : false,
  );

  return {
    streaming: workId ? (slot?.streaming ?? false) : Object.values(slots).some((x) => x.streaming),
    streamingWorkId,
    otherStreaming,
    buffer: slot?.buffer ?? '',
    thinkingBuffer: slot?.thinkingBuffer ?? '',
    error: slot?.error ?? null,
    partialKept: slot?.partialKept ?? false,
    targetMessageId: slot?.targetMessageId ?? null,
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
