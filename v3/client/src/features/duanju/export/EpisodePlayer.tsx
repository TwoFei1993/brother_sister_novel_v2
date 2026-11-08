/**
 * 整集连播（共识 D10 / Phase 4）：按镜头序自动连播已回传成品，检查衔接
 *
 * 简洁实现：<video> 列表按序播放——ended → 下一条；支持跳过/上一条/重播。
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { duanjuFileUrl } from '../../../api/duanju';
import type { DuanjuShot } from '@shared/duanju';

interface Props {
  workId: string;
  shots: DuanjuShot[];
  onClose: () => void;
}

export default function EpisodePlayer({ workId, shots, onClose }: Props) {
  const playable = shots.filter((s) => s.finalVideo);
  const [idx, setIdx] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    videoRef.current?.play().catch(() => undefined); // 自动播放被拦时等用户点击
  }, [idx]);

  if (playable.length === 0) return null;
  const shot = playable[idx];

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col gap-3 px-4 md:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="整集连播"
      >
        <div className="flex items-center justify-between text-white/80">
          <span className="text-sm">
            S{String(shot.index).padStart(2, '0')}（{idx + 1}/{playable.length}）
          </span>
          <button type="button" onClick={onClose} aria-label="关闭" className="flex h-9 w-9 items-center justify-center">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <video
          ref={videoRef}
          key={shot.id}
          src={duanjuFileUrl(workId, shot.finalVideo!.path)}
          controls
          playsInline
          onEnded={() => (idx + 1 < playable.length ? setIdx(idx + 1) : undefined)}
          className="w-full rounded-xl bg-black"
        />
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={() => setIdx(Math.max(0, idx - 1))}
            disabled={idx === 0}
            className="h-10 rounded-lg border border-white/30 px-4 text-sm text-white/90 disabled:opacity-40"
          >
            上一条
          </button>
          <button
            type="button"
            onClick={() => videoRef.current?.play().catch(() => undefined)}
            className="h-10 rounded-lg bg-white/15 px-4 text-sm text-white/90"
          >
            重播
          </button>
          <button
            type="button"
            onClick={() => (idx + 1 < playable.length ? setIdx(idx + 1) : onClose())}
            className="h-10 rounded-lg border border-white/30 px-4 text-sm text-white/90"
          >
            {idx + 1 < playable.length ? '跳过 →' : '播完关闭'}
          </button>
        </div>
      </div>
    </div>
  );
}
