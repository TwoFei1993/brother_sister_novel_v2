/**
 * 素材总览（平板适配 commit 同批）：聚合项目全部生成素材统一浏览
 *
 * 收集角色设定图 / 场景图 / 镜头四宫格 / 成品视频 → 网格缩略图（角标标来源）→
 * 点击进大图预览（图片全屏 + 下载；视频直接播放）。
 */
import { useMemo, useState } from 'react';
import { Download, Play, X } from 'lucide-react';

import { duanjuFileUrl } from '../../../api/duanju';
import type { DuanjuProject, StoredImage } from '@shared/duanju';

interface Props {
  workId: string;
  project: DuanjuProject;
}

interface Asset {
  id: string;
  kind: 'character' | 'scene' | 'grid' | 'video';
  /** 来源标注（如「林小满 · 设定图」「S03 · 四宫格」） */
  label: string;
  path: string;
}

const KIND_LABEL: Record<Asset['kind'], string> = {
  character: '角色',
  scene: '场景',
  grid: '四宫格',
  video: '成品',
};

export default function AssetGallery({ workId, project }: Props) {
  const [preview, setPreview] = useState<Asset | null>(null);

  const assets = useMemo<Asset[]>(() => {
    const out: Asset[] = [];
    for (const c of project.characters) {
      for (const img of c.sheetImages) {
        out.push({ id: img.id, kind: 'character', label: `${c.name || '未命名'} · 设定图`, path: img.path });
      }
    }
    for (const s of project.scenes) {
      for (const img of s.images) {
        out.push({ id: img.id, kind: 'scene', label: `${s.name || '未命名'} · 场景图`, path: img.path });
      }
    }
    for (const s of project.shots) {
      if (s.gridImage) {
        out.push({ id: s.gridImage.id, kind: 'grid', label: `S${String(s.index).padStart(2, '0')} · 四宫格`, path: s.gridImage.path });
      }
      if (s.finalVideo) {
        out.push({ id: `v-${s.finalVideo.path}`, kind: 'video', label: `S${String(s.index).padStart(2, '0')} · 成品视频`, path: s.finalVideo.path });
      }
    }
    return out;
  }, [project]);

  if (assets.length === 0) {
    return (
      <section className="mt-6 rounded-xl border border-[hsl(var(--border-soft))] px-4 py-6 text-center text-sm text-[hsl(var(--fg-muted))]" data-testid="duanju-assets">
        还没有生成素材——角色/场景/分镜 tab 出图后在此统一查看
      </section>
    );
  }

  const counts = {
    character: assets.filter((a) => a.kind === 'character').length,
    scene: assets.filter((a) => a.kind === 'scene').length,
    grid: assets.filter((a) => a.kind === 'grid').length,
    video: assets.filter((a) => a.kind === 'video').length,
  };

  return (
    <section className="mt-6" data-testid="duanju-assets">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        🖼️ 素材总览
        <span className="text-xs font-normal text-[hsl(var(--fg-muted))]">
          共 {assets.length} 项 · 角色 {counts.character} / 场景 {counts.scene} / 四宫格 {counts.grid} / 成品 {counts.video}
        </span>
      </h3>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {assets.map((a) => {
          const isVideo = a.kind === 'video';
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setPreview(a)}
              className="group relative overflow-hidden rounded-lg border border-[hsl(var(--border-soft))]"
              aria-label={a.label}
            >
              {isVideo ? (
                <div className="flex aspect-square w-full items-center justify-center bg-[hsl(var(--bg))]">
                  <Play className="h-8 w-8 text-[hsl(var(--accent))]" aria-hidden />
                </div>
              ) : (
                <img src={duanjuFileUrl(workId, a.path)} alt={a.label} loading="lazy" className="aspect-square w-full object-cover" />
              )}
              <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90 backdrop-blur">
                {KIND_LABEL[a.kind]}
              </span>
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] text-white/90">
                {a.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* 大图/播放预览 */}
      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4" onClick={() => setPreview(null)}>
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col gap-3" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="素材预览">
            <div className="flex items-center justify-between text-white/80">
              <span className="text-sm">{preview.label}</span>
              <div className="flex items-center gap-2">
                <a
                  href={duanjuFileUrl(workId, preview.path)}
                  download
                  className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"
                  aria-label="下载"
                >
                  <Download className="h-4 w-4" aria-hidden />
                </a>
                <button type="button" onClick={() => setPreview(null)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10" aria-label="关闭">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            {preview.kind === 'video' ? (
              <video src={duanjuFileUrl(workId, preview.path)} controls autoPlay playsInline className="max-h-[80vh] w-full rounded-xl bg-black" />
            ) : (
              <img src={duanjuFileUrl(workId, preview.path)} alt={preview.label} className="max-h-[80vh] w-full rounded-xl object-contain" />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
