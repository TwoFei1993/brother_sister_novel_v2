/**
 * 帧区组件（成本优化 A 项）：分帧 2×2 展示 + 单帧重roll + 补缺帧 + 拼图下载 + 帧描述编辑
 *
 * - frames CSS 2×2 排布（无需真拼图文件）；每帧角上重roll（只花 1 张钱）
 * - 旧 gridImage 兼容展示（标注「旧整图」；补缺帧后即切换分帧）
 * - gridParts 帧描述可编辑（改完重roll 该帧生效）
 */
import { useState } from 'react';
import { Download, Grid2X2, RefreshCw } from 'lucide-react';

import { useDuanjuStore } from '../store';
import { useSettingsStore } from '../../../stores/settings';
import { generateDuanjuImage, duanjuFileUrl } from '../../../api/duanju';
import { buildFramePrompt } from '../lib/prompts/prompts-storyboard';
import { downloadFrameGrid, missingFrames } from '../lib/cost/frameGrid';
import type { DuanjuProject, DuanjuShot } from '@shared/duanju';

interface Props {
  workId: string;
  shot: DuanjuShot;
  project: DuanjuProject;
}

export default function FramesGrid({ workId, shot, project }: Props) {
  const { patch } = useDuanjuStore();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frames = shot.frames ?? [];
  const missing = missingFrames(shot);

  /** 生成/重roll 单帧；成功返回 true（补帧串行时用返回值判断是否继续） */
  async function generateFrame(frameIndex: number): Promise<boolean> {
    setBusy(frameIndex);
    setError(null);
    try {
      await generateDuanjuImage(workId, {
        kind: 'frame',
        refId: shot.id,
        frameIndex,
        prompt: buildFramePrompt(shot, frameIndex, project),
        aspectRatio: '9:16', // 竖屏短剧视频规格（1080×1920 9:16），首帧图生视频免裁切
        provider: useSettingsStore.getState().llmPrefs.imageProvider,
      });
      await useDuanjuStore.getState().load(workId);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** 补齐缺失帧（串行，失败即停——避免连环烧钱） */
  async function generateMissing(): Promise<void> {
    const fresh = useDuanjuStore.getState().project?.shots.find((s) => s.id === shot.id) ?? shot;
    for (const i of missingFrames(fresh)) {
      const ok = await generateFrame(i);
      if (!ok) break;
    }
  }

  async function savePart(i: number, text: string): Promise<void> {
    const parts = [...(shot.gridParts ?? [])];
    while (parts.length < 4) parts.push('');
    parts[i] = text;
    const shots = project.shots.map((s) =>
      s.id === shot.id ? { ...s, gridParts: parts.slice(0, 4), updatedAt: Date.now() } : s,
    );
    await patch(workId, { shots });
  }

  function downloadGrid(): void {
    const urls = [1, 2, 3, 4]
      .map((i) => frames.find((f) => f.index === i))
      .map((f) => (f ? duanjuFileUrl(workId, f.image.path) : ''));
    if (urls.some((u) => !u)) return;
    void downloadFrameGrid(urls, `S${String(shot.index).padStart(2, '0')}.png`).catch((e) =>
      setError(e instanceof Error ? e.message : '拼图下载失败'),
    );
  }

  const inputCls =
    'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 py-1.5 text-xs outline-none focus:border-[hsl(var(--accent))]';

  return (
    <div className="w-full shrink-0 sm:w-56 md:w-64">
      {/* 帧 2×2（旧整图模式：frames 为空且有 gridImage 时整图占满展示） */}
      {frames.length === 0 && shot.gridImage ? (
        <div className="overflow-hidden rounded-lg border border-[hsl(var(--border-soft))]">
          <img
            src={duanjuFileUrl(workId, shot.gridImage.path)}
            alt={`镜头 ${shot.index} 旧四宫格`}
            className="aspect-[9/16] w-full object-cover"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1">
          {[1, 2, 3, 4].map((i) => {
            const f = frames.find((x) => x.index === i);
            return (
              <div
                key={i}
                className="group relative overflow-hidden rounded-md border border-[hsl(var(--border-soft))]"
                data-testid={`frame-${i}`}
              >
                {f ? (
                  <img
                    src={duanjuFileUrl(workId, f.image.path)}
                    alt={`镜头 ${shot.index} 第 ${i} 帧`}
                    className="aspect-[9/16] w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-[9/16] w-full items-center justify-center bg-[hsl(var(--bg))] text-[10px] text-[hsl(var(--fg-muted))]">
                    F{i} 待生成
                  </div>
                )}
                {f && (
                  <button
                    type="button"
                    onClick={() => void generateFrame(i)}
                    disabled={busy !== null}
                    title={f.rolls > 0 ? `重roll（已重 ${f.rolls} 次）` : '重roll 此帧'}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 focus:opacity-100 group-hover:opacity-100"
                    data-testid={`frame-reroll-${i}`}
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {frames.length === 0 && shot.gridImage && (
        <p className="mt-1 text-[10px] text-[hsl(var(--fg-muted))]">旧整图模式（补帧后切换分帧）</p>
      )}

      {/* 操作 */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        {missing.length > 0 && (
          <button
            type="button"
            onClick={() => void generateMissing()}
            disabled={busy !== null}
            className="col-span-2 flex h-9 items-center justify-center gap-1 rounded-lg bg-[hsl(var(--accent))] text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
            data-testid="frame-gen-missing"
          >
            <Grid2X2 className="h-3.5 w-3.5" aria-hidden />
            {busy !== null
              ? '生成中…'
              : frames.length === 0
                ? `生成 4 帧（约 ${(4 * 0.2).toFixed(1)} 元）`
                : `补 ${missing.length} 帧（约 ${(missing.length * 0.2).toFixed(1)} 元）`}
          </button>
        )}
        {frames.length === 4 && (
          <button
            type="button"
            onClick={downloadGrid}
            className="col-span-2 flex h-9 items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs"
            data-testid="frame-download-grid"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            下载 2×2 拼图
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-[hsl(var(--danger))]" role="alert">
          {error}
        </p>
      )}

      {/* 帧描述（分帧 prompt 数据源，可编辑） */}
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-[hsl(var(--fg-muted))]">帧描述（改后重roll 生效）</summary>
        <div className="mt-1 space-y-1">
          {[0, 1, 2, 3].map((i) => (
            <input
              key={i}
              defaultValue={(shot.gridParts ?? [])[i] ?? ''}
              onBlur={(e) => {
                const cur = (shot.gridParts ?? [])[i] ?? '';
                if (e.target.value !== cur) void savePart(i, e.target.value);
              }}
              placeholder={`第 ${i + 1} 帧：核心动作瞬间`}
              className={inputCls}
              aria-label={`第 ${i + 1} 帧描述`}
              data-testid={`frame-part-${i + 1}`}
            />
          ))}
        </div>
      </details>
    </div>
  );
}
