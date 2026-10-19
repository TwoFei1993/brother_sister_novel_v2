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
import { useCallback, useRef, useState } from 'react';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

import { buildGenerateBody } from '../api/llm';
import { useGenerationStore } from '../stores/generation';

import {
  MAX_SWIPES,
  buildContinueDirective,
  historyBeforeTarget,
  swipeLimitError,
} from './generation-flow';
import { runGenerationStream } from './generation-runtime';
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
  /** 停止当前生成（已产出部分保留在界面，「继续」可用） */
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
  // 上下文截断提示（store 收束即清零，generationStore 不留痕，挂 hook 本地态最小改动）
  const [lastTruncated, setLastTruncated] = useState(false);
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
          const assets: AssembleAssets = await loadAssembleAssets(work);
          const pending: PendingVars = { work: new Map(), global: new Map() };
          const env = buildMacroEnv(work, assets.cards[0]?.data.name ?? undefined, pending);
          const tail: AssembleTail = { kind: 'directive', text: directive };
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

  const generateChapter = useCallback(
    (work: Work, messages: Message[], directive: string) =>
      run(work, messages, directive, { targetId: crypto.randomUUID(), initialBuffer: '' }),
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
    (work: Work, messages: Message[], target: Message) => {
      if (target.swipes.length >= MAX_SWIPES) {
        useGenerationStore.getState().fail(swipeLimitError(), false);
        return Promise.resolve(null);
      }
      // 对齐 chat 语义：上下文取 target 之前（被重roll章节的旧候选不进上下文）
      return run(work, historyBeforeTarget(messages, target.id), target.directive ?? '', {
        targetId: target.id,
        initialBuffer: '',
        swipeTarget: target,
      });
    },
    [run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
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
    stop,
    clearError,
    lastTruncated,
    clearTruncated,
  };
}
