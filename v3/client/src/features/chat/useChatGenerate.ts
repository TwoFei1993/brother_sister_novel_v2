/**
 * chat 生成流 hook（设计 §4.3 chat 模式 / §9.1 重试 / §9.2 生成事务性）
 *
 * 对位 hooks/useGenerate.ts 的 chat 语义薄封装：
 * - sendMessage：用户对话文本走 ctx.userMessage（非 novel 的 directive），
 *   {{char}} 宏绑定 pickSpeaker 激活角色（由调用方传入 speaker）
 * - continueFromPartial：断流半成品 + 原对话文本重组上下文再发起（非续传）
 * - swipeRegenerate：重 roll 激活角色的回复，候选 push 进既有消息 swipes
 *   （上下文取 target 之前；候选达 MAX_SWIPES 上限拒绝）
 * - 流编排（重试/停止/事务 fail）统一走 generation-runtime 共享内核；错误统一 GenerationError
 *
 * 真实 UI 接线（ChatWorkspace）见 features/chat/ChatWorkspace.tsx。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@shared/message';
import type { TavernRegexScript } from '@shared/tavern';
import type { Work } from '@shared/work';

import { buildGenerateBody } from '../../api/llm';
import { useGenerationStore } from '../../stores/generation';
import type { ChatMember } from '../../engine/prompt/chat/activation';
import { MAX_SWIPES, historyBeforeTarget, swipeLimitError } from '../../hooks/generation-flow';
import { runGenerationStream } from '../../hooks/generation-runtime';
import { loadAssembleAssets, loadRegexScripts, type AssembleAssets, type PendingVars } from '../../hooks/generation-pipeline';

import {
  buildChatMacroEnv,
  finalizeChatGeneration,
  runChatWithMetaRetry,
  scanAndAssembleChat,
  type ChatRunOptions,
  type ChatTurn,
} from './chat-flow';

/** 单次生成编排参数（targetId 预生成 uuid 作入库幂等键；重试专用字段见 ChatRunOptions） */
type RunOptions = ChatRunOptions;

export interface UseChatGenerateResult {
  streaming: boolean;
  buffer: string;
  error: { code: string; message: string } | null;
  partialKept: boolean;
  targetMessageId: string | null;
  /** 显示轨正则脚本（markdownOnly，作品绑定资产；气泡渲染前应用，§5.1②） */
  regexScripts: TavernRegexScript[];
  /** 发送用户对话并生成激活角色回复；返回成对入库消息（user 先 assistant 后落盘）。
   *  opts.implicit=true：隐式引导——文本进上下文但不入库为 user 消息 */
  sendMessage: (userText: string, speaker: ChatMember, opts?: { implicit?: boolean }) => Promise<ChatTurn | null>;
  /** 断流后「继续」：半成品作基底，携带原对话文本重组上下文再发起 */
  continueFromPartial: (partial: string, userText: string, speaker: ChatMember) => Promise<ChatTurn | null>;
  /** 换一支：重 roll 该消息（激活角色 = 传入 speaker），结果 push 进 target.swipes */
  swipeRegenerate: (target: Message, speaker: ChatMember) => Promise<ChatTurn | null>;
  /** 停止当前生成（已产出部分保留在界面） */
  stop: () => void;
  /** 关闭错误提示（保留半成品供继续） */
  clearError: () => void;
}

export function useChatGenerate(work: Work, messages: Message[]): UseChatGenerateResult {
  const abortRef = useRef<AbortController | null>(null);
  // 消息流经 ref 转发：方法内始终读最新值，避免长生命周期回调闭包陈旧数组
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // 显示轨正则脚本：挂载时拉取一次（单项失败静默跳过，不阻塞对话）
  const [regexScripts, setRegexScripts] = useState<TavernRegexScript[]>([]);
  useEffect(() => {
    let alive = true;
    loadRegexScripts(work)
      .then((list) => {
        if (alive) setRegexScripts(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [work]);

  const run = useCallback(
    (history: Message[], userText: string, speaker: ChatMember, opts: RunOptions): Promise<ChatTurn | null> =>
      runGenerationStream<ChatTurn>({
        workId: work.id,
        targetId: opts.targetId,
        initialBuffer: opts.initialBuffer,
        bindController: (c) => {
          abortRef.current = c;
        },
        prepare: async ({ prefs, startedAt }) => {
          // ---------- 组装阶段：资产拉取 → chat 语义宏环境 → 扫描总装（userMessage 通道） ----------
          const assets: AssembleAssets = await loadAssembleAssets(work);
          const pending: PendingVars = { work: new Map(), global: new Map() };
          const env = buildChatMacroEnv(work, speaker, pending);
          // 重试后缀只进提示词；入库 user 消息保持干净文本（对齐 novel 的 promptDirective 语义）
          const fitted = await scanAndAssembleChat(work, history, opts.promptUserText ?? userText, assets, env, prefs);
          const body = buildGenerateBody({
            source: prefs.source,
            model: prefs.model,
            messages: fitted.messages,
            temperature: prefs.temperature,
            maxTokens: prefs.maxTokens,
          });
          return {
            body,
            // ---------- 完成收尾：后处理 → user+assistant 成对入库 → 变量回写 ----------
            // 隐式引导：finalize 的 userText 传空串 → 复用 finalize 对空串跳过入库的语义
            finalize: () =>
              finalizeChatGeneration({
                work,
                userText: opts.implicitUser ? '' : userText,
                speaker,
                swipeTarget: opts.swipeTarget ?? null,
                assets,
                env,
                prefs,
                promptTokens: fitted.promptTokens,
                activatedIds: fitted.activatedIds,
                startedAt,
                pending,
              }),
          };
        },
      }),
    [work],
  );

  const sendMessage = useCallback(
    (userText: string, speaker: ChatMember, sendOpts?: { implicit?: boolean }) =>
      runChatWithMetaRetry(run, messagesRef.current, userText, speaker, {
        targetId: crypto.randomUUID(),
        initialBuffer: '',
        ...(sendOpts?.implicit ? { implicitUser: true } : {}),
      }),
    [run],
  );

  const continueFromPartial = useCallback(
    (partial: string, userText: string, speaker: ChatMember) => {
      const targetId = useGenerationStore.getState().targetMessageId ?? crypto.randomUUID();
      return runChatWithMetaRetry(run, messagesRef.current, userText, speaker, { targetId, initialBuffer: partial });
    },
    [run],
  );

  const swipeRegenerate = useCallback(
    (target: Message, speaker: ChatMember) => {
      if (target.swipes.length >= MAX_SWIPES) {
        useGenerationStore.getState().fail(swipeLimitError(), false);
        return Promise.resolve(null);
      }
      // 历史 = 目标消息之前的部分（重 roll 不把旧候选装进上下文）
      return runChatWithMetaRetry(run, historyBeforeTarget(messagesRef.current, target.id), '', speaker, {
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
    regexScripts,
    sendMessage,
    continueFromPartial,
    swipeRegenerate,
    stop,
    clearError,
  };
}
