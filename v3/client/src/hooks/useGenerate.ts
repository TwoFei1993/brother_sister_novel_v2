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

import { buildGenerateBody } from '../api/llm';
import { useGenerationStore } from '../stores/generation';
import { useWorkStore } from '../stores/work';

import {
  MAX_SWIPES,
  buildContinueDirective,
  historyBeforeTarget,
  nextChapterIndex,
  remainingChapters,
  swipeLimitError,
} from './generation-flow';
import { runGenerationStream } from './generation-runtime';
import { META_ONLY_PLACEHOLDER } from '../engine/prompt/postprocess';
import {
  buildMacroEnv,
  finalizeGeneration,
  loadAssembleAssets,
  scanAndAssemble,
  type AssembleAssets,
  type AssembleTail,
  type PendingVars,
} from './generation-pipeline';

/** 单次生成的编排参数（targetId 预生成 uuid 作入库幂等键） */
interface RunOptions {
  targetId: string;
  initialBuffer: string;
  /** swipe 重生成：候选进该消息的 swipes，而非新建消息 */
  swipeTarget?: Message;
  /** 重试等场景：只替换提示词尾的指令文本（wire）；入库的 directive 元数据仍用干净原指令 */
  promptDirective?: string;
}

/** 连写批次进度（null = 空闲）：done=已写到的最大章号，total=目标章节数 */
export interface BatchProgress {
  done: number;
  total: number;
}

export interface UseGenerateResult {
  streaming: boolean;
  buffer: string;
  error: { code: string; message: string } | null;
  partialKept: boolean;
  targetMessageId: string | null;
  /** novel 模式：按剧情指令生成一章，返回入库消息（失败返回 null） */
  generateChapter: (work: Work, messages: Message[], directive: string) => Promise<Message | null>;
  /** 断流后「继续」：半成品作基底，以续写指令重新发起 */
  continueFromPartial: (work: Work, messages: Message[], partial: string) => Promise<Message | null>;
  /** 换一支：同 directive 重生成，结果 push 进 target.swipes（幂等 upsert） */
  swipeRegenerate: (work: Work, messages: Message[], target: Message) => Promise<Message | null>;
  /** 一键连写：从下一章自动写到目标章节数（第一章用传入指令、后续空指令自由发挥） */
  runBatch: (work: Work, firstDirective: string) => Promise<void>;
  /** 连写进度（null = 空闲；CommandBar 停止按钮进度文案消费） */
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
          const assets: AssembleAssets = await loadAssembleAssets(work);
          const pending: PendingVars = { work: new Map(), global: new Map() };
          const env = buildMacroEnv(work, assets.cards[0]?.data.name ?? undefined, pending);
          // 重试后缀只进提示词；入库 directive 元数据保持干净原指令（A 视图编辑/重roll 不见机器文本）
          const tail: AssembleTail = { kind: 'directive', text: opts.promptDirective ?? directive };
          const fitted = await scanAndAssemble(work, messages, tail, assets, env, prefs);
          const body = buildGenerateBody({
            source: prefs.source,
            model: prefs.model,
            messages: fitted.messages,
            temperature: prefs.temperature,
            maxTokens: prefs.maxTokens,
          });
          return {
            body,
            // ---------- 完成收尾：后处理 → 幂等入库 → 变量回写 → 记录截断 ----------
            finalize: async () => {
              const msg = await finalizeGeneration({
                work,
                messages,
                directive,
                swipeTarget: opts.swipeTarget ?? null,
                assets,
                env,
                prefs,
                promptTokens: fitted.promptTokens,
                activatedIds: fitted.activatedIds,
                startedAt,
                pending,
              });
              setLastTruncated(fitted.truncated);
              return msg;
            },
          };
        },
      }),
    [],
  );

  /** 元信息残章自动重试后缀（Sudachi 类思维链预设偶发：整轮输出只有思考没有正文） */
  const META_RETRY_SUFFIX =
    '\n\n（系统重试：上一次输出只有思考没有正文，视为无效。这次请跳过一切思考与提纲，直接输出完整正文。）';
  /** 是否「正常完成但产物为元信息残章」——仅 finalize 成功返回的消息参与判定；
   *  run 返回 null（流中错误/用户停止/防重入）不算残章，交由上层终止/提示，绝不重试；
   *  content 非字符串（异常数据）视为正常消息，不误触发重试 */
  const isMetaOnly = (m: Message | null): boolean => {
    if (m === null) return false;
    const c = m.content;
    return typeof c === 'string' && (!c.trim() || c.startsWith(META_ONLY_PLACEHOLDER));
  };

  const generateChapter = useCallback(
    async (work: Work, messages: Message[], directive: string) => {
      let msg = await run(work, messages, directive, { targetId: crypto.randomUUID(), initialBuffer: '' });
      if (isMetaOnly(msg)) {
        msg = await run(work, messages, directive, {
          targetId: crypto.randomUUID(),
          initialBuffer: '',
          promptDirective: directive + META_RETRY_SUFFIX, // 后缀只进提示词，不入库 metadata
        });
      }
      // 重试一次后仍是残章（或本次即失败）：返回 null——占位章不入库、不上架（batch 以 null 终止）
      return isMetaOnly(msg) ? null : msg;
    },
    [run],
  );

  const continueFromPartial = useCallback(
    (work: Work, messages: Message[], partial: string) => {
      const targetId = useGenerationStore.getState().targetMessageId ?? crypto.randomUUID();
      return run(work, messages, buildContinueDirective(partial), { targetId, initialBuffer: partial });
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
      let msg = await run(work, historyBeforeTarget(messages, target.id), directive, {
        targetId: target.id,
        initialBuffer: '',
        swipeTarget: target,
      });
      if (isMetaOnly(msg)) {
        msg = await run(work, historyBeforeTarget(messages, target.id), directive, {
          targetId: target.id,
          initialBuffer: '',
          swipeTarget: target,
          promptDirective: directive + META_RETRY_SUFFIX, // 后缀只进提示词，不入库 metadata
        });
      }
      // 重试一次后仍是残章（或本次即失败）：返回 null，保留原候选不动（占位内容不进 swipes）
      return isMetaOnly(msg) ? null : msg;
    },
    [run],
  );

  const stop = useCallback(() => {
    batchCancelRef.current = true; // 连写循环下一轮检查后退出
    abortRef.current?.abort();
  }, []);

  /** 一键连写：循环单章生成直到目标章节数；出错/用户停止即停，已入库章节保留。
   *  每轮从 work store 读最新 messages（上一章已 upsertLocal），规避闭包陈旧。 */
  const runBatch = useCallback(
    async (work: Work, firstDirective: string): Promise<void> => {
      const total = work.settings.desiredChapterCount;
      if (useGenerationStore.getState().streaming) return; // 防重入（单章生成中不可发起连写）
      batchCancelRef.current = false;
      try {
        let first = true;
        for (;;) {
          const messages = useWorkStore.getState().messages;
          if (remainingChapters(messages, total) <= 0 || batchCancelRef.current) break;
          setBatch({ done: nextChapterIndex(messages) - 1, total });
          const msg = await generateChapter(work, messages, first ? firstDirective : '');
          first = false;
          if (msg) useWorkStore.getState().upsertLocal(msg);
          if (!msg || batchCancelRef.current) break; // 出错/停止即停（error 已进 store 提示）
        }
      } finally {
        setBatch(null);
        batchCancelRef.current = false;
      }
    },
    [generateChapter],
  );

  const clearError = useCallback(() => useGenerationStore.getState().clearError(), []);

  return {
    streaming: useGenerationStore((s) => s.streaming),
    buffer: useGenerationStore((s) => s.buffer),
    error: useGenerationStore((s) => s.error),
    partialKept: useGenerationStore((s) => s.partialKept),
    targetMessageId: useGenerationStore((s) => s.targetMessageId),
    generateChapter,
    continueFromPartial,
    swipeRegenerate,
    runBatch,
    batch,
    stop,
    clearError,
    lastTruncated,
    clearTruncated,
  };
}
