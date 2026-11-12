/**
 * 剧本分区（共识 D5：三来源 + 定稿门 + AI 拆解审核卡）
 *
 * - 三来源：AI 生成（ScriptGenerateForm 流式）/ 粘贴 / 手写 —— 统一落到剧本文本框
 * - 「定稿」：确认后解锁下游 tab（D3 依赖门）；定稿后仍可改，改后下游标 stale
 * - 「AI 拆解」：server 后台任务化（切出 App 后生成继续，回来轮询取结果）→ parseBreakdown → ReviewCards
 */
import { useEffect, useState } from 'react';

import { useDuanjuStore } from '../store';
import { buildBreakdownMessages, parseBreakdown, mergeEpisodes } from '../lib/prompts/prompts-script';
import { runBreakdownPipeline } from '../lib/duanju-pipeline';
import { useSettingsStore } from '../../../stores/settings';
import ScriptGenerateForm from './ScriptGenerateForm';
import ReviewCards from './ReviewCards';
import { useBgLlmTask } from '../../../hooks/useBgLlmTask';
import type { DuanjuScript } from '@shared/duanju';

const SRC_LABELS: Record<DuanjuScript['source'], string> = {
  ai: 'AI 生成',
  pasted: '粘贴',
  manual: '手写',
};

export default function ScriptPane({ workId }: { workId: string }) {
  const { project, patch, saving } = useDuanjuStore();
  const [text, setText] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [source, setSource] = useState<DuanjuScript['source']>('manual');
  const [genOpen, setGenOpen] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  /** 拆解完成后的自动流水线进度（角色→场景→逐集拆镜头；切出安全） */
  const [pipelineLabel, setPipelineLabel] = useState<string | null>(null);

  // 拆解后台化（切出 App 继续生成）：slot 隔离 + 回来轮询取结果/恢复轮询
  const bg = useBgLlmTask(
    `script-breakdown-${workId}`,
    (raw) => {
      const cur = useDuanjuStore.getState().project;
      if (!cur) return;
      const parsed = parseBreakdown(raw);
      if (!parsed) {
        setBreakdownError('拆解结果解析失败（模型未返回合法 JSON），请重试');
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
      const mergedEpisodes = mergeEpisodes(cur.episodes, parsed.episodes, cur.shots);
      void patch(workId, { reviewCards, episodes: mergedEpisodes });
      // 拆解完成 → 自动流水线串联：提取角色 → 提取场景 → 逐集拆镜头（后台任务，切出安全）
      const prefs = useSettingsStore.getState().llmPrefs;
      void runBreakdownPipeline(
        {
          workId,
          project: { ...cur, reviewCards, episodes: mergedEpisodes },
        },
        { source: prefs.source, model: prefs.model, thinking: prefs.thinking !== false },
      )
        .then(() => setPipelineLabel(null))
        .catch((err: unknown) => {
          setPipelineLabel(null);
          setBreakdownError(`流水线中断：${err instanceof Error ? err.message : '未知错误'}——已完成步骤的成果已保留，失败步骤可手动补跑`);
        });
    },
    (msg) => setBreakdownError(msg),
  );

  // 后台任务恢复（mount 一次）：切出期间完成的拆解自动回填
  useEffect(() => {
    bg.resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  // project 载入/外部刷新时同步本地编辑态
  useEffect(() => {
    if (project) {
      setText(project.script.text);
      setConfirmed(project.script.confirmed);
      setSource(project.script.source);
    }
  }, [project]);

  if (!project) return null;

  async function saveScript(next?: {
    confirmed?: boolean;
    text?: string;
    source?: DuanjuScript['source'];
  }): Promise<void> {
    await patch(workId, {
      script: {
        source: next?.source ?? source,
        text: next?.text ?? text,
        confirmed: next?.confirmed ?? confirmed,
        updatedAt: Date.now(),
      },
    });
  }

  /** AI 拆解 → server 后台任务（切出安全；预算协商 server 端同语义） */
  async function runBreakdown(): Promise<void> {
    if (!project || !text.trim() || bg.state?.status === 'submitting' || bg.state?.status === 'running') return;
    setBreakdownError(null);
    // 深度测试实测：拆解基于编辑中文本而违审替换作用于已保存文本——未保存就拆解会让采纳静默失效。
    if (dirty) {
      await patch(workId, {
        script: { source, text, confirmed, updatedAt: Date.now() },
      });
    }
    const prefs = useSettingsStore.getState().llmPrefs;
    await bg.submit({
      source: prefs.source,
      model: prefs.model,
      messages: buildBreakdownMessages(text, project.targetEpisodes),
      params: { max_tokens: 32000 },
      thinking: false,
      label: '拆解',
    });
  }

  const dirty =
    text !== project.script.text ||
    confirmed !== project.script.confirmed ||
    source !== project.script.source;

  const bgRunning = bg.state?.status === 'submitting' || bg.state?.status === 'running';

  return (
    <div className="mx-auto flex w-full max-w-3xl lg:max-w-5xl flex-col gap-4 px-4 py-4" data-testid="duanju-script">
      {breakdownError && (
        <p className="text-xs text-[hsl(var(--danger))]" role="alert">
          {breakdownError}
        </p>
      )}

      {/* 来源与操作 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[hsl(var(--fg-muted))]">来源：{SRC_LABELS[source]}</span>
        <button
          type="button"
          onClick={() => setGenOpen(true)}
          className="h-9 rounded-lg border border-[hsl(var(--accent))] px-3 text-xs text-[hsl(var(--accent))]"
          data-testid="script-ai-gen"
        >
          ✨ AI 生成剧本
        </button>
        {text.trim() && (
          <button
            type="button"
            onClick={() => void runBreakdown()}
            disabled={bgRunning}
            className="h-9 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
            data-testid="script-breakdown"
          >
            {bgRunning
              ? `拆解中…（已等 ${bg.state?.elapsedSec ?? 0}s，可切出）`
              : project.reviewCards.summary
                ? '重新 AI 拆解'
                : 'AI 拆解 → 审核卡'}
          </button>
        )}
      </div>

      {/* 拆解完成后：审核卡前置（结构化可读），剧本原文折叠（反馈 #4：一大段难读） */}
      {project.reviewCards.summary ? (
        <>
          <ReviewCards workId={workId} />
          <details className="rounded-xl border border-[hsl(var(--border-soft))] px-4 py-3" data-testid="script-raw-details">
            <summary className="cursor-pointer text-sm font-medium">📜 剧本原文（点击展开编辑）</summary>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'粘贴剧本，或手写，或点「AI 生成剧本」……\n格式建议：每行一个镜头（场景｜人物｜动作｜台词）'}
              rows={14}
              className="mt-3 w-full rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-4 py-3 text-sm leading-7 outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
              data-testid="script-text"
            />
          </details>
        </>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'粘贴剧本，或手写，或点「AI 生成剧本」……\n格式建议：每行一个镜头（场景｜人物｜动作｜台词）'}
          rows={14}
          className="w-full rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-4 py-3 text-sm leading-7 outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
          data-testid="script-text"
        />
      )}

      {/* 保存 + 定稿 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void saveScript()}
          disabled={!dirty || saving}
          className="h-10 rounded-lg border border-[hsl(var(--border-soft))] px-4 text-sm disabled:opacity-40"
          data-testid="script-save"
        >
          {saving ? '保存中…' : '保存剧本'}
        </button>
        <label className="flex items-center gap-2 text-sm text-[hsl(var(--fg-muted))]" data-testid="script-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              void saveScript({ confirmed: e.target.checked });
            }}
          />
          定稿（解锁角色/场景/分镜）
        </label>
      </div>

      {bgRunning && (
        <p className="text-xs text-[hsl(var(--fg-muted))]" data-testid="breakdown-bg-hint">
          ⏳ 拆解在服务端后台进行——可切出去干别的，回来自动查看结果。
        </p>
      )}

      {pipelineLabel && (
        <p
          className="text-xs text-[hsl(var(--accent))]"
          data-testid="breakdown-pipeline-hint"
        >
          ⚡ 自动流水线：{pipelineLabel}…（后台执行，可切出 App）
        </p>
      )}

      {genOpen && (
        <ScriptGenerateForm
          project={project}
          onClose={() => setGenOpen(false)}
          onGenerated={(genText) => {
            setGenOpen(false);
            setText(genText);
            setSource('ai');
            setConfirmed(false);
            void saveScript({ text: genText, source: 'ai', confirmed: false });
          }}
        />
      )}
    </div>
  );
}
