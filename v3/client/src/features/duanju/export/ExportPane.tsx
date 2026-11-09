/**
 * 出图/导出分区（共识 D8 / 实施计划 T3.4 + T4.2）
 *
 * - 集选择 + 整集导出 zip（server archiver：镜头表 md + E-S 命名四宫格）
 * - 成品连播（Phase 4 EpisodePlayer 实装）
 */
import { useMemo, useState } from 'react';

import { useDuanjuStore } from '../store';
import { buildVideoPrompt } from '../lib/prompts/prompts-storyboard';
import { buildScriptMd, buildScriptTxt, downloadText } from '../lib/exportScript';
import AssetGallery from './AssetGallery';
import EpisodePlayer from './EpisodePlayer';
import SpendCard from './SpendCard';

export default function ExportPane({ workId }: { workId: string }) {
  const { project } = useDuanjuStore();
  const [epIndex, setEpIndex] = useState(1);
  const [playerOpen, setPlayerOpen] = useState(false);

  const episode = useMemo(
    () => project?.episodes.find((e) => e.index === epIndex) ?? null,
    [project, epIndex],
  );
  const shots = useMemo(
    () =>
      project
        ? [...project.shots].filter((s) => s.episodeId === episode?.id).sort((a, b) => a.index - b.index)
        : [],
    [project, episode],
  );

  if (!project) return null;
  const withImage = shots.filter((s) => (s.frames?.length ?? 0) > 0 || s.gridImage).length;
  const withVideo = shots.filter((s) => s.finalVideo).length;

  return (
    <div className="mx-auto w-full max-w-3xl lg:max-w-5xl px-4 py-4" data-testid="duanju-export">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={epIndex}
          onChange={(e) => setEpIndex(Number(e.target.value))}
          aria-label="选择集"
          className="h-9 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none"
        >
          {project.episodes.map((ep) => (
            <option key={ep.id} value={ep.index}>
              第 {ep.index} 集《{ep.title}》
            </option>
          ))}
        </select>
        <span className="text-xs text-[hsl(var(--fg-muted))]">
          {shots.length} 镜 · {withImage} 已出图 · {withVideo} 已回传成品
        </span>
      </div>

      {/* 成本仪表盘（生图花费可见化） */}
      <SpendCard />

      {episode && (
        <div className="space-y-3">
          <a
            href={`/api/works/${workId}/duanju/export/${episode.id}`}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] ${withImage === 0 ? 'opacity-40 pointer-events-none' : ''}"
            data-testid="export-zip"
            aria-disabled={withImage === 0}
            onClick={(e) => {
              if (withImage === 0) e.preventDefault();
            }}
          >
            📦 下载整集导出包（{withImage} 个镜头的分镜图 + 镜头表）
          </a>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() =>
                downloadText(`E${episode.index}-${episode.title}.md`, buildScriptMd(project, episode, shots))
              }
              disabled={shots.length === 0}
              className="flex h-10 items-center justify-center gap-2 rounded-lg border border-[hsl(var(--border-soft))] text-xs disabled:opacity-40"
              data-testid="export-script-md"
            >
              📝 下载剧本（Markdown）
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(`E${episode.index}-${episode.title}.txt`, buildScriptTxt(project, episode, shots))
              }
              disabled={shots.length === 0}
              className="flex h-10 items-center justify-center gap-2 rounded-lg border border-[hsl(var(--border-soft))] text-xs disabled:opacity-40"
              data-testid="export-script-txt"
            >
              📄 下载剧本（TXT）
            </button>
          </div>
          <p className="text-xs text-[hsl(var(--fg-muted))]">
            剧本含秒级时间轴（每镜头起止时间码，可在分镜 tab 调整每镜时长）——对应即梦生成视频的时长节奏。
          </p>
          <p className="text-xs leading-5 text-[hsl(var(--fg-muted))]">
            解压后按 E-S(-F) 编号顺序在即梦做图生视频（每行提示词已写进镜头表）；
            成品视频回 App 分镜 tab 对应镜头卡上传归档。
          </p>
          <button
            type="button"
            onClick={() => setPlayerOpen(true)}
            disabled={withVideo === 0}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[hsl(var(--border-soft))] text-sm disabled:opacity-40"
            data-testid="export-play"
          >
            ▶️ 整集连播检查衔接（{withVideo} 个成品）
          </button>
        </div>
      )}

      {/* 素材总览：项目全部生成素材统一浏览（大图/播放/下载） */}
      <AssetGallery workId={workId} project={project} />

      {/* 提示词速览（复制备用） */}
      {shots.length > 0 && (
        <details className="mt-6 rounded-xl border border-[hsl(var(--border-soft))] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">本集视频提示词汇总（点击展开）</summary>
          <div className="mt-3 space-y-3">
            {shots.map((s) => (
              <div key={s.id} className="rounded-lg border border-[hsl(var(--border-soft))] p-3">
                <p className="mb-1 text-xs font-medium text-[hsl(var(--fg-muted))]">
                  S{String(s.index).padStart(2, '0')} · {s.shotSize} · {s.cameraMove}
                </p>
                <pre className="whitespace-pre-wrap text-xs leading-5">{buildVideoPrompt(s, project)}</pre>
              </div>
            ))}
          </div>
        </details>
      )}

      {playerOpen && episode && (
        <EpisodePlayer workId={workId} shots={shots} onClose={() => setPlayerOpen(false)} />
      )}
    </div>
  );
}
