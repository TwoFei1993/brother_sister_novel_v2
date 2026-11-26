/**
 * 「AI 拆解 → 审核卡 → 自动流水线」的编排（设计共识 2026-11-26 第 3.6 节）：
 *
 * - 拆解走服务端后台任务（切出安全）；结果应用时先把原文暂存，保存成功才清除并启动流水线——
 *   保存往返期间页面被回收，回到剧本 tab 会把暂存的原文重新应用，不丢这一次拆解
 * - 拆解结果保存成功后再启动流水线（流水线的分集剧本步骤依赖集列表已落库）
 * - 流水线运行或停靠中：拆解入口由调用方禁用（避免集列表被替换时流水线还在逐集写）
 */
import { useCallback, useEffect, useState } from 'react';

import type { GenerateMessage } from '../../../../api/llm';
import { useBgLlmTask } from '../../../../hooks/useBgLlmTask';
import { useSettingsStore } from '../../../../stores/settings';
import { startPipeline } from '../../lib/pipeline/runner';
import { usePipelineStore } from '../../lib/pipeline/stores';
import { mergeEpisodes, parseBreakdown } from '../../lib/prompts/prompts-script';
import { useDuanjuStore } from '../../store';

const rawKey = (workId: string): string => `duanju-breakdown-raw-${workId}`;

const readRaw = (workId: string): string | null => {
  try {
    return localStorage.getItem(rawKey(workId));
  } catch {
    return null;
  }
};

export function useBreakdownFlow(workId: string) {
  const patch = useDuanjuStore((s) => s.patch);
  const pipelineStatus = usePipelineStore((s) => s.runs[workId]?.status);
  const [error, setError] = useState<string | null>(null);
  /** 有暂存但还没应用成功的拆解结果（显示「重试应用」） */
  const [stashed, setStashed] = useState<boolean>(() => readRaw(workId) !== null);

  /** 应用拆解结果：解析 → 暂存原文 → 保存审核卡与集列表 → 启动流水线 */
  const applyBreakdown = useCallback(
    (raw: string) => {
      const cur = useDuanjuStore.getState().project;
      if (!cur) return;
      const parsed = parseBreakdown(raw);
      if (!parsed) {
        setError('拆解结果解析失败（模型未返回合法 JSON），请重试');
        return;
      }
      const now = Date.now();
      const reviewCards = {
        summary: parsed.summary,
        eventChain: parsed.eventChain,
        conflict: parsed.conflict,
        characterRelations: parsed.characterRelations,
        emotionPoints: parsed.emotionPoints,
        visualActions: parsed.visualActions,
        riskReplacements: parsed.riskReplacements.map((r, i) => ({
          id: `risk-${now}-${i}`,
          original: r.original,
          replacement: r.replacement,
        })),
        confirmed: {},
        updatedAt: now,
      };
      const episodes = mergeEpisodes(cur.episodes, parsed.episodes, cur.shots);
      try {
        localStorage.setItem(rawKey(workId), raw);
      } catch {
        /* 存不进去：保存往返期间页面被回收会丢这一次拆解，可重新拆解 */
      }
      setStashed(true);
      void (async () => {
        const ok = await patch(workId, { reviewCards, episodes });
        if (!ok) {
          setError('拆解结果保存失败（版本冲突或网络）——结果已暂存，点「重试应用」');
          return;
        }
        try {
          localStorage.removeItem(rawKey(workId));
        } catch {
          /* 同上 */
        }
        setStashed(false);
        void startPipeline(workId); // 保存成功后再启动：分集剧本步骤依赖集列表已落库
      })();
    },
    [workId, patch],
  );

  const bg = useBgLlmTask(`script-breakdown-${workId}`, applyBreakdown, (msg) => setError(msg));

  // 回到剧本 tab：拆解在途就续轮询；上次保存没成功的拆解结果重新应用
  useEffect(() => {
    bg.resume();
    const raw = readRaw(workId);
    if (raw) applyBreakdown(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  const running = bg.state?.status === 'submitting' || bg.state?.status === 'running';

  /** 提交 AI 拆解（切出安全；预算协商在服务端） */
  const submit = useCallback(
    (messages: GenerateMessage[]): Promise<void> => {
      const prefs = useSettingsStore.getState().llmPrefs;
      return bg.submit({ source: prefs.source, model: prefs.model, messages, params: { max_tokens: 32000 }, thinking: false, label: '拆解' });
    },
    [bg],
  );

  return {
    error,
    clearError: (): void => setError(null),
    running,
    elapsedSec: bg.state?.elapsedSec ?? 0,
    submit,
    stashed,
    retryApply: (): void => {
      const raw = readRaw(workId);
      if (raw) applyBreakdown(raw);
      else setStashed(false);
    },
    /** 流水线正在跑或停靠中：会替换集列表的操作应禁用 */
    pipelineBusy: pipelineStatus === 'running' || pipelineStatus === 'paused',
  };
}
