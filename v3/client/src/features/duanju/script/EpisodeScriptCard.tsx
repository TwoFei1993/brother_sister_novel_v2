/**
 * 单集剧本卡（设计共识 2026-11-26 第 3.4 节）：状态 + 展开后的编辑器与操作。
 *
 * - 编辑器的值：有草稿用草稿，否则用已保存的剧本；AI 结果先进草稿，点「保存并采用」才落库
 * - 操作：AI 改编 / 续写（按原文性质二选一）、按要求重写、保存并采用、放弃修改
 * - 来源（设计 3.3）：在编辑器里点保存记手写；重写后保存不改来源；保存空白等于清除本集剧本
 * - 「原文即第 1 集」的集不另存副本：只读提示，到上方的原文框编辑
 * - 流水线运行中或本集生成中：AI 按钮禁用（流水线写的就是这些集，两边同时写会互相盖）
 */
import { useMemo, useState } from 'react';

import type { DuanjuEpisode, DuanjuProject, EpisodeScriptSource } from '@shared/duanju';

import { episodeGenMode } from '../lib/pipeline/episodeGen';
import { withEpisodeScript } from '../lib/pipeline/merge';
import { effectiveEpisodeScript, hasEpisodeScript } from '../lib/pipeline/source';
import { useEpisodeDraftStore } from '../lib/pipeline/stores';
import { useDuanjuStore } from '../store';
import { useEpisodeGen } from './hooks/useEpisodeGen';

const SOURCE_LABELS: Record<EpisodeScriptSource, string> = {
  adapted: 'AI 改编',
  continued: 'AI 续写',
  manual: '手写',
};

const chipCls = (tone: 'ok' | 'muted' | 'warn'): string =>
  `shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
    tone === 'ok'
      ? 'bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
      : tone === 'warn'
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
        : 'bg-[hsl(var(--fg-muted))]/10 text-[hsl(var(--fg-muted))]'
  }`;

/** 草稿是哪种 AI 操作产出的：重写后保存不改来源 */
type DraftKind = 'auto' | 'rewrite';

interface Props {
  workId: string;
  project: DuanjuProject;
  episode: DuanjuEpisode;
  open: boolean;
  onToggle: () => void;
  saving: boolean;
  gen: ReturnType<typeof useEpisodeGen>;
  /** 流水线正在跑：AI 按钮禁用（停靠中等审时不算） */
  pipelineRunning: boolean;
}

export default function EpisodeScriptCard({ workId, project, episode, open, onToggle, saving, gen, pipelineRunning }: Props) {
  // 直接读 store 里的那一项：undefined = 没有草稿；空串 = 用户把内容删光了（保存空白 = 清除）
  const draft = useEpisodeDraftStore((s) => s.drafts[`${workId}:${episode.id}`]);
  const [draftKind, setDraftKind] = useState<DraftKind | null>(null);
  const [directive, setDirective] = useState('');
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const saved = effectiveEpisodeScript(project, episode) ?? '';
  const isOriginal = !hasEpisodeScript(episode) && Boolean(saved); // 「只有第 1 集」的第 1 集：原文即剧本
  const value = draft ?? saved;
  const dirty = draft !== undefined && draft !== saved;
  /** 把已有的剧本删光再保存 = 清除本集剧本 */
  const clearing = dirty && draft !== undefined && draft.trim() === '';
  const generatingThis = gen.active?.episodeId === episode.id;
  const busy = Boolean(gen.active) || saving || pipelineRunning;
  // 切片定位要扫原文：只在作品数据或这一集变了的时候重算，用户在原文框里打字不触发
  const mode = useMemo(() => episodeGenMode(project, episode), [project, episode]);

  async function save(): Promise<void> {
    if (!dirty || busy) return;
    if (clearing && !confirm('内容是空的——保存等于清除这一集已保存的剧本，它会回到「未写」。继续？')) return;
    setLocalError(null);
    const cur = useDuanjuStore.getState().project;
    if (!cur) return;
    // 重写不改来源；其余在编辑器里保存的都记手写（设计 3.3）
    const keepSource = draftKind === 'rewrite' && episode.scriptSource && episode.scriptSource !== 'manual' ? episode.scriptSource : null;
    const ok = await useDuanjuStore.getState().patch(workId, {
      episodes: withEpisodeScript(cur.episodes, episode.id, draft ?? '', keepSource ?? 'manual', Date.now()),
    });
    if (ok) {
      useEpisodeDraftStore.getState().clearDraft(workId, episode.id);
      setDraftKind(null);
      setDirective('');
      setRewriteOpen(false);
    } else {
      setLocalError('保存失败（可能版本冲突或网络异常），草稿还在，请刷新后重试');
    }
  }

  function discard(): void {
    useEpisodeDraftStore.getState().clearDraft(workId, episode.id);
    setDraftKind(null);
  }

  const genLabel = generatingThis
    ? `AI ${gen.active?.kind === 'rewrite' ? '重写' : mode === 'continue' ? '续写' : '改编'}中…`
    : null;

  return (
    <section
      className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]"
      data-testid={`ep-script-${episode.index}`}
      data-open={open ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left"
        data-testid={`ep-script-toggle-${episode.index}`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--accent))]/60 text-[11px] font-bold text-[hsl(var(--accent))]">
          {episode.index}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">《{episode.title}》</span>
        {generatingThis ? (
          <span className={chipCls('warn')}>{genLabel}</span>
        ) : isOriginal ? (
          <span className={chipCls('muted')}>原文即第 1 集</span>
        ) : episode.scriptSource ? (
          <span className={chipCls('ok')}>已采用·{SOURCE_LABELS[episode.scriptSource]}</span>
        ) : (
          <span className={chipCls('muted')}>未写</span>
        )}
        {value.trim() && <span className="shrink-0 text-[11px] tabular-nums text-[hsl(var(--fg-muted))]">{value.trim().length} 字</span>}
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-[hsl(var(--border-soft))] px-3 py-3">
          {episode.synopsis.trim() && <p className="text-xs leading-5 text-[hsl(var(--fg-muted))]">{episode.synopsis.trim()}</p>}
          {isOriginal ? (
            <p className="text-xs leading-5 text-[hsl(var(--fg-muted))]">这本书的原文就是第 1 集的剧本——要改请到上方「剧本原文」里改。</p>
          ) : (
            <textarea
              value={value}
              onChange={(e) => useEpisodeDraftStore.getState().setDraft(workId, episode.id, e.target.value)}
              rows={12}
              aria-label={`第 ${episode.index} 集剧本`}
              data-testid={`ep-script-text-${episode.index}`}
              className="w-full resize-y rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm leading-7 outline-none focus:border-[hsl(var(--accent))]"
            />
          )}

          {!isOriginal && (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraftKind('auto');
                  void gen.start(episode, 'auto');
                }}
                data-testid={`ep-script-gen-${episode.index}`}
                title={mode === 'continue' ? '按本集梗概与前面各集写出这一集' : '从本集对应的原文改编出这一集'}
                className="min-h-8 rounded-lg border border-[hsl(var(--accent))] px-2.5 text-xs text-[hsl(var(--accent))] disabled:opacity-40"
              >
                {generatingThis ? genLabel : mode === 'continue' ? `AI ${episode.scriptSource === 'continued' ? '重新续写' : '续写'}本集` : `AI ${episode.scriptSource === 'adapted' ? '重新改编' : '改编'}本集`}
              </button>
              {saved.trim() && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRewriteOpen((v) => !v)}
                  data-testid={`ep-script-rewrite-open-${episode.index}`}
                  className="min-h-8 rounded-lg border border-[hsl(var(--border-soft))] px-2.5 text-xs text-[hsl(var(--fg-muted))] disabled:opacity-40"
                >
                  按要求重写
                </button>
              )}
              {dirty && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save()}
                    data-testid={`ep-script-save-${episode.index}`}
                    className="min-h-8 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
                  >
                    {clearing ? '清除本集剧本' : saving ? '保存中…' : '保存并采用'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={discard}
                    data-testid={`ep-script-discard-${episode.index}`}
                    className="min-h-8 rounded-lg border border-[hsl(var(--border-soft))] px-2.5 text-xs text-[hsl(var(--fg-muted))] disabled:opacity-40"
                  >
                    放弃修改
                  </button>
                </>
              )}
            </div>
          )}

          {rewriteOpen && saved.trim() && (
            <div className="flex flex-col gap-1.5" data-testid={`ep-script-rewrite-box-${episode.index}`}>
              <textarea
                value={directive}
                onChange={(e) => setDirective(e.target.value)}
                rows={2}
                aria-label="修改意见"
                placeholder="修改意见：如「场 2 的对白太生硬，改得口语一些」「节奏太慢，删掉场 4」"
                className="w-full resize-y rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-xs leading-5 outline-none focus:border-[hsl(var(--accent))]"
              />
              <button
                type="button"
                disabled={busy || !directive.trim()}
                onClick={() => {
                  setDraftKind('rewrite');
                  void gen.start(episode, 'rewrite', directive.trim());
                }}
                data-testid={`ep-script-rewrite-${episode.index}`}
                className="min-h-8 self-start rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
              >
                按意见重写
              </button>
            </div>
          )}

          {localError && (
            <p className="text-xs text-[hsl(var(--danger))]" role="alert">
              {localError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
