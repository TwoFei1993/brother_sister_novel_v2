/**
 * 分集剧本区（设计共识 2026-11-26 第 3.4 节）：每集一张卡 + 顶部操作。
 *
 * 顶部：「一键改编全部未写集」（只写剧本，写完即停）、原文性质下拉（整本小说 / 只有第 1 集，判断不准可手改）、
 * 停靠开关（剧本写完后先停下等审）。原文性质与停靠开关保存时展开保留同对象的其余字段。
 * 流水线运行中：一键入口与单集的 AI 按钮禁用（停靠中等审时单集可改）。
 * 切片定位要扫原文：未写集数只在作品数据变化时重算。
 */
import { useMemo, useState } from 'react';

import type { DuanjuProject, ScriptScope } from '@shared/duanju';

import { startPipeline } from '../lib/pipeline/runner';
import { assembleEpisodeSource, hasEpisodeScript, scriptScopeOf } from '../lib/pipeline/source';
import { usePipelineStore } from '../lib/pipeline/stores';
import { useDuanjuStore } from '../store';
import EpisodeScriptCard from './EpisodeScriptCard';
import { useEpisodeGen } from './hooks/useEpisodeGen';

const SCOPE_LABELS: Record<ScriptScope, string> = {
  full: '整本小说（各集从原文改编）',
  episode1: '只有第 1 集（后面各集续写）',
};

const inputCls =
  'h-9 min-w-0 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none focus:border-[hsl(var(--accent))]';

/** 需要写的集：没有剧本、且不是「原文即第 1 集」 */
function unwrittenCount(project: DuanjuProject): number {
  return project.episodes.filter((e) => !hasEpisodeScript(e) && !assembleEpisodeSource(project, e).skip).length;
}

/** 老作品没有原文位置锚点：改编切不到本集对应的原文 */
function lacksAnchors(project: DuanjuProject): boolean {
  return project.episodes.length > 0 && project.episodes.every((e) => !e.sourceStart?.trim());
}

export default function EpisodeScripts({ workId }: { workId: string }) {
  const { project, patch, saving } = useDuanjuStore();
  const run = usePipelineStore((s) => s.runs[workId]);
  const gen = useEpisodeGen(workId);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toWrite = useMemo(() => (project ? unwrittenCount(project) : 0), [project]);

  if (!project) return null;
  const pipelineRunning = run?.status === 'running' || run?.status === 'paused';
  const pipelineBusy = run?.status === 'running';
  const scope = scriptScopeOf(project);
  const episodes = [...project.episodes].sort((a, b) => a.index - b.index);
  /** 要靠原文改编、却没有任何一集带原文位置锚点（重新拆解一次才有） */
  const anchorsMissing = scope === 'full' && toWrite > 0 && lacksAnchors(project);

  async function adaptAll(): Promise<void> {
    if (pipelineRunning || toWrite === 0) return;
    if (!confirm(`将调用 AI ${toWrite} 次，为还没写的 ${toWrite} 集各生成一集剧本（已有剧本的集不动）。继续？`)) return;
    setError(null);
    const out = await startPipeline(workId, { fromStep: 'script', onlyScript: true });
    if (out?.status === 'failed') setError('一键改编没能启动——请确认已在设置页选择模型');
  }

  return (
    <section className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]" data-testid="episode-scripts">
      <header className="flex flex-col gap-2 border-b border-[hsl(var(--border-soft))] px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="m-serif text-base font-semibold">分集剧本</h3>
          <p className="mt-0.5 text-xs leading-5 text-[hsl(var(--fg-muted))]">
            每集都有自己的剧本正文，拆镜头只读本集。手动点 AI 写出的先进草稿，点「保存并采用」才落库；自动流水线写的直接落库，可随时改。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void adaptAll()}
          disabled={pipelineRunning || toWrite === 0 || episodes.length === 0}
          data-testid="ep-scripts-adapt-all"
          className="h-9 shrink-0 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
        >
          一键改编全部未写集{episodes.length > 0 ? `（${toWrite}）` : ''}
        </button>
      </header>

      {episodes.length === 0 ? (
        <p className="px-4 py-5 text-xs leading-5 text-[hsl(var(--fg-muted))]" data-testid="ep-scripts-empty">
          还没有分集——先点上面的「AI 拆解 → 审核卡」，拆出各集标题与梗概后，这里逐集写剧本。
        </p>
      ) : (
        <div className="flex flex-col gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-w-0 items-center gap-1.5 text-xs text-[hsl(var(--fg-muted))]">
              原文性质
              <select
                value={scope}
                disabled={pipelineRunning}
                onChange={(e) => void patch(workId, { script: { ...project.script, scope: e.target.value as ScriptScope } })}
                aria-label="原文性质"
                data-testid="ep-scripts-scope"
                className={inputCls}
              >
                {Object.entries(SCOPE_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-[11px] leading-4 text-[hsl(var(--fg-muted))]">判断不准可以在这里改</span>
            <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--fg-muted))]">
              <input
                type="checkbox"
                checked={project.pipeline?.pauseAfterScripts === true}
                disabled={pipelineRunning}
                onChange={(e) =>
                  void patch(workId, { pipeline: { ...project.pipeline, pauseAfterScripts: e.target.checked } })
                }
                data-testid="ep-scripts-pause-switch"
              />
              自动流水线：剧本写完后先停下等我审
            </label>
          </div>

          {anchorsMissing && (
            <p className="text-xs leading-5 text-amber-600 dark:text-amber-400" data-testid="ep-scripts-no-anchors">
              这些集还没有原文位置锚点（重新 AI 拆解一次才会带上）：现在改编只能对着整篇原文写，容易串到别的集。建议先点上面的「重新 AI 拆解」。
            </p>
          )}

          {error && (
            <p className="text-xs text-[hsl(var(--danger))]" role="alert">
              {error}
            </p>
          )}
          {gen.error && (
            <p className="text-xs text-[hsl(var(--danger))]" role="alert" data-testid="ep-scripts-gen-error">
              第 {(episodes.find((e) => e.id === gen.error?.episodeId)?.index) ?? '?'} 集：{gen.error.message}
            </p>
          )}

          {episodes.map((ep) => (
            <EpisodeScriptCard
              key={ep.id}
              workId={workId}
              project={project}
              episode={ep}
              open={openIndex === ep.index}
              onToggle={() => setOpenIndex(openIndex === ep.index ? null : ep.index)}
              saving={saving}
              gen={gen}
              pipelineRunning={pipelineBusy}
            />
          ))}
        </div>
      )}
    </section>
  );
}
