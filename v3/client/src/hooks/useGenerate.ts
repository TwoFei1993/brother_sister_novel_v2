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

import { buildGenerateBody } from '../api/llm';
import { isCollapsedText } from '../engine/prompt/novel/collapse-detect';
import { useGenerationStore } from '../stores/generation';
import { useSettingsStore } from '../stores/settings';
import { useWorkStore } from '../stores/work';

import {
  MAX_SWIPES,
  buildContinueDirective,
  historyBeforeTarget,
  nextChapterIndex,
  swipeLimitError,
  type BatchProgress,
} from './generation-flow';
import { isTruncatedText } from '../lib/truncation';
import { runChunkLoop, runOutlineLoop } from './generation-batch';
import { persistMessage } from './generation-pipeline';
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
}

/** 连写/大纲批次进度类型与常量已收敛至 generation-flow（BatchProgress/BATCH_CHUNK_SIZE） */

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
          // P2.2 绑定三态：按本章章号过滤增量绑定素材（写第 C 章只带 fromChapter≤C 的生效素材）
          const assets: AssembleAssets = await loadAssembleAssets(work, nextChapterIndex(messages));
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
            frequencyPenalty: prefs.frequencyPenalty,
            presencePenalty: prefs.presencePenalty,
            repetitionPenalty: prefs.repetitionPenalty,
            thinking: prefs.thinking !== false, // D4：缺省视为开（老用户 localStorage 无此字段也有💭）
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

  /** 元信息残章自动重试后缀（Sudachi 类思维链预设偶发：整轮输出只有思考没有正文） */
  const META_RETRY_SUFFIX =
    '\n\n（系统重试：上一次输出只有思考没有正文，视为无效。这次请跳过一切思考与提纲，直接输出完整正文。）';
  /** 重复循环崩溃自动重试后缀（深度测试实测：长上下文连写中后段单短语重复上千次）
   *  指令要点对照酒馆社区 anti-slop 实践（autonovel ANTI-SLOP / antislop-sampler 的提示词层方案） */
  const COLLAPSE_RETRY_SUFFIX =
    '\n\n（系统重试：上一次输出在中后段陷入同一短语的机械重复，属无效输出。这次必须：每写一段都推进剧情，' +
    '禁止用重复描写填充篇幅；同一个比喻/意象全文最多出现一次；不要复用任何章节的开篇句式；' +
    '句式长短交错，连续三句长句后必须接短句；写完剧情指令要求的事件再收尾。）';
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

  const generateChapter = useCallback(
    async (work: Work, messages: Message[], directive: string) => {
      // 重试复用同一 targetId：入库按 messageId 幂等 upsert，重试结果覆盖首次无效行
      //（否则首次残章/崩溃行以孤儿形式留在库里，重载后出现垃圾章节）
      const targetId = uuid();
      let msg = await run(work, messages, directive, { targetId, initialBuffer: '' });
      const reason = invalidReasonOf(msg);
      if (msg && reason) {
        // 残章/重复循环：带专用重试后缀再来一次（后缀只进提示词；落库按首次消息 id 幂等覆盖）
        msg = await run(work, messages, directive, {
          targetId,
          initialBuffer: '',
          promptDirective: directive + RETRY_SUFFIX[reason],
          persistMessageId: msg.id,
        });
      }
      // 截断自动续写（feedback：经常没写完就结束）：双判据——
      // 1) 上游 finish_reason='length'/'max_tokens'（决定性：输出被 max_tokens 腰斩，无论结尾标点）
      // 2) 启发式：结尾无句末标点的连续叙述（断流等无 finish 帧场景的兜底）
      // 最多续写 2 轮（每轮续完重新检测；推理模型思考吃预算的章常需两轮才补完）
      for (let rounds = 0; rounds < 2 && msg; rounds += 1) {
        const finish = useGenerationStore.getState().finishReason;
        const outputTruncated = finish === 'length' || finish === 'max_tokens';
        if (!outputTruncated && !isTruncatedText(msg.content)) break;
        const partial = msg.content;
        msg = await run(work, messages, buildContinueDirective(partial), {
          targetId,
          initialBuffer: partial,
          promptDirective: directive,
          persistMessageId: msg.id, // 补完结果同 id 覆盖（否则半成品行以孤儿形式残留，重载出现重复章节）
        });
      }
      // 润色模型 pass（P2-2）：设置 polishModel 后用第二模型对全文润色（保持情节/事实/字数），
      // 同 id 幂等覆盖落库行；润色失败静默保留原稿（正文本身已可用）
      const polishModel = useSettingsStore.getState().llmPrefs.polishModel;
      if (msg && polishModel) {
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
                { role: 'user', content: msg.content },
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
      // 重试一次后仍无效（或本次即失败）：返回 null——调用方不上架（batch 以 null 终止）；
      // 库中该 id 行已被末次输出覆盖，不产生重复章节行
      return invalidReasonOf(msg) ? null : msg;
    },
    [run],
  );

  const continueFromPartial = useCallback(
    (work: Work, messages: Message[], partial: string) => {
      const targetId = useGenerationStore.getState().targetMessageId ?? uuid();
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
      const reason = invalidReasonOf(msg);
      if (msg && reason) {
        msg = await run(work, historyBeforeTarget(messages, target.id), directive, {
          targetId: target.id,
          initialBuffer: '',
          swipeTarget: target,
          promptDirective: directive + RETRY_SUFFIX[reason], // 后缀只进提示词，不入库 metadata
        });
      }
      // 重试一次后仍无效（或本次即失败）：返回 null，保留原候选不动（占位内容不进 swipes）
      return invalidReasonOf(msg) ? null : msg;
    },
    [run],

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
    buffer: useGenerationStore((s) => s.buffer),
    error: useGenerationStore((s) => s.error),
    partialKept: useGenerationStore((s) => s.partialKept),
    targetMessageId: useGenerationStore((s) => s.targetMessageId),
    generateChapter,
    continueFromPartial,
    swipeRegenerate,
    runBatch,
    runByOutline,
    batch,
    stop,
    clearError,
    lastTruncated,
    clearTruncated,
  };
}
