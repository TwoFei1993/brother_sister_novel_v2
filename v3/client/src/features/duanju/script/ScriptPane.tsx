/**
 * 剧本分区（共识 D5：三来源 + 定稿门 + AI 拆解审核卡）
 *
 * - 三来源：AI 生成（ScriptGenerateForm 流式）/ 粘贴 / 手写 —— 统一落到剧本文本框
 * - 「定稿」：确认后解锁下游 tab（D3 依赖门）；定稿后仍可改，改后下游标 stale
 * - 「AI 拆解」：generateTextOnce → parseBreakdown → ReviewCards 逐项编辑确认
 */
import { useEffect, useState } from 'react';

import { useDuanjuStore } from '../store';
import { buildBreakdownMessages, parseBreakdown, mergeEpisodes } from '../lib/prompts-script';
import { generateTextOnce } from '../../../api/llm';
import { useSettingsStore } from '../../../stores/settings';
import ScriptGenerateForm from './ScriptGenerateForm';
import ReviewCards from './ReviewCards';
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
  const [breakingDown, setBreakingDown] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);

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

  /** AI 拆解 → 审核卡（generateTextOnce 非流式拿 JSON） */
  async function runBreakdown(): Promise<void> {
    if (!project || !text.trim() || breakingDown) return;
    setBreakingDown(true);
    setBreakdownError(null);
    try {
      // 深度测试实测：拆解基于编辑中文本而违审替换作用于已保存文本——未保存就拆解会让采纳静默失效。
      // 拆解前先把编辑中的剧本落库（dirty 时），保证剧本/审核卡/替换三者一致，也防编辑丢失。
      if (dirty) {
        await patch(workId, {
          script: { source, text, confirmed, updatedAt: Date.now() },
        });
      }
      const prefs = useSettingsStore.getState().llmPrefs;
      const raw = await generateTextOnce({
        source: prefs.source,
        model: prefs.model,
        messages: buildBreakdownMessages(text, project.targetEpisodes),
        thinking: false,
      });
      const parsed = parseBreakdown(raw);
      if (!parsed) {
        setBreakdownError('拆解结果解析失败（模型未返回合法 JSON），请重试');
        return;
      }
      // 拆解结果写入 reviewCards + episodes，待人工逐项确认。
      // episodes 按 index 合并保留原 id（防孤儿 shots，深度测试抓出——见 mergeEpisodes 注释）
      const now = Date.now();
      const mergedEpisodes = mergeEpisodes(project.episodes, parsed.episodes, project.shots);
      await patch(workId, {
        reviewCards: {
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
        },
        episodes: mergedEpisodes,
      });
    } catch (err) {
      setBreakdownError(err instanceof Error ? err.message : '拆解失败，请重试');
    } finally {
      setBreakingDown(false);
    }
  }

  const dirty =
    text !== project.script.text ||
    confirmed !== project.script.confirmed ||
    source !== project.script.source;

  return (
    <div className="mx-auto flex w-full max-w-3xl lg:max-w-5xl flex-col gap-4 px-4 py-4" data-testid="duanju-script">

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
            disabled={breakingDown}
            className="h-9 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
            data-testid="script-breakdown"
          >
            {breakingDown
              ? '拆解中…'
              : project.reviewCards.summary
                ? '重新 AI 拆解'
                : 'AI 拆解 → 审核卡'}
          </button>
        )}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'粘贴剧本，或手写，或点「AI 生成剧本」……\n格式建议：每行一个镜头（场景｜人物｜动作｜台词）'}
        rows={14}
        className="w-full rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-4 py-3 text-sm leading-6 outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
        data-testid="script-text"
      />

      {breakdownError && (
        <p className="text-xs text-[hsl(var(--danger))]" role="alert">
          {breakdownError}
        </p>
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

      {project.reviewCards.summary && <ReviewCards workId={workId} />}

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
