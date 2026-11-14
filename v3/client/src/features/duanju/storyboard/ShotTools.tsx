/**
 * 镜头卡工具组（frontend-design 精修拆分）：提示词复制 + 即梦/豆包跳转 + 成品上传/播放
 *
 * 视觉分组：主操作「复制提示词」accent 强调（用得最多）；平台跳转次级；
 * 上传回流虚线全宽（低频）。视频播放区独立在组下。
 */
import { type RefObject } from 'react';
import { ExternalLink, Upload } from 'lucide-react';

import { duanjuFileUrl } from '../../../api/duanju';
import type { DuanjuShot } from '@shared/duanju';

import type { LocalGenProgress } from '../../../hooks/useLocalVideoGen';

export type { LocalGenProgress };

const JIMENG_URL = 'https://jimeng.jianying.com/';
const DOUBAO_URL = 'https://www.doubao.com/chat/';

interface Props {
  workId: string;
  shot: DuanjuShot;
  hasImage: boolean;
  copied: boolean;
  uploading: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onCopy: () => void;
  onUploadVideo: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenFilePicker: () => void;
  /** 下载分镜图（四宫格整图或首帧；旧/新模式兼容） */
  onDownloadImage: () => void;
  localGenError: string | null;
  /** 本地 ComfyUI 视频生成（第四通道）：可用态 + 进行态回调 */
  localGenAvailable: boolean;
  localGenState: LocalGenProgress | null;
  onLocalGen: () => void;
  /** 抽卡试跑（3 秒/73 帧快速验证动作与口型，满意再出终稿） */
  onLocalGenTrial: () => void;
}

const toolCls = 'flex h-8 items-center justify-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] text-[11px] text-[hsl(var(--fg-muted))] transition-colors hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--fg))]';

export default function ShotTools({
  workId,
  shot,
  hasImage,
  copied,
  uploading,
  fileRef,
  onCopy,
  onUploadVideo,
  onOpenFilePicker,
  onDownloadImage,
  localGenError,
  localGenAvailable,
  localGenState,
  onLocalGen,
  onLocalGenTrial,
}: Props) {
  const jump = (url: string) => () => {
    onCopy();
    window.open(url, '_blank', 'noreferrer');
  };

  return (
    <div>
      <button
        type="button"
        onClick={onLocalGen}
        disabled={!!localGenState || !hasImage || !localGenAvailable}
        className="flex h-9 w-full items-center justify-center gap-1 rounded-lg border border-[hsl(var(--accent))]/60 bg-[hsl(var(--accent))]/10 text-xs font-medium text-[hsl(var(--accent))] transition-colors hover:bg-[hsl(var(--accent))]/20 disabled:opacity-40"
        data-testid="shot-local-gen"
        title="本地 ComfyUI + H3：分帧图作首帧，免费出片"
      >
        🎬 {localGenState ? `本地生成中（${localGenState.phase === 'uploading' ? '传帧图' : localGenState.phase === 'queued' ? '排队' : localGenState.phase === 'downloading' ? '取片' : '生成'} ${localGenState.elapsedSec}s）` : localGenAvailable ? '本地生成视频（免费·音画一体）' : '本地生成视频（需先配置引擎）'}
      </button>
      {localGenAvailable && (
        <button
          type="button"
          onClick={onLocalGenTrial}
          disabled={!!localGenState}
          className="mt-1.5 flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[hsl(var(--border-soft))] text-[11px] text-[hsl(var(--fg-muted))] transition-colors hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))] disabled:opacity-40"
          data-testid="shot-local-gen-trial"
          title="抽卡试跑：3 秒快速验证动作/运镜/口型，满意再出完整终稿——终稿时长越长越贵，先小注试探"
        >
          ⚡ 试跑 3 秒（抽卡验证）
        </button>
      )}
      {localGenError && (
        <div role="alert" className="mt-1.5 rounded-lg border border-[hsl(var(--danger))]/40 bg-[hsl(var(--danger))]/10 px-2.5 py-2 text-[11px] leading-4 text-[hsl(var(--danger))]">
          <p>{localGenError}</p>
          <p className="mt-1 opacity-80">
            质量不稳时的升级三步：①改写镜头描述强化人物/场景锚点再试 → ②时长缩短到 6 秒内（不稳定镜头安全上限）→ ③把镜头拆成两个短镜头
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={onCopy}
        disabled={!hasImage}
        className={`flex h-9 w-full items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
          hasImage
            ? 'bg-[hsl(var(--accent))]/15 text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/25'
            : 'border border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
        }`}
        data-testid="shot-copy-prompt"
      >
        {copied ? '✓ 提示词已复制' : '📋 复制视频提示词'}
      </button>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <a
          href={JIMENG_URL}
          target="_blank"
          rel="noreferrer"
          onClick={jump(JIMENG_URL)}
          title="提示词已复制——粘贴到即梦图生视频"
          className={toolCls}
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          即梦
        </a>
        <a
          href={DOUBAO_URL}
          target="_blank"
          rel="noreferrer"
          onClick={jump(DOUBAO_URL)}
          title="提示词已复制——豆包免费生图（生成后回 App 上传回流）"
          className={toolCls}
          data-testid="shot-doubao"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          豆包
        </a>
        <button
          type="button"
          onClick={hasImage ? onDownloadImage : onOpenFilePicker}
          className={toolCls}
          title={hasImage ? '下载分镜图（喂即梦用）' : '尚无分镜图——生成后可下载'}
        >
          ⬇ 分镜图
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className={`${toolCls} ${shot.finalVideo ? 'text-[hsl(var(--accent))]' : ''}`}
          data-testid="shot-upload-video"
          title={shot.finalVideo ? '已有成品——可替换' : '即梦生成成品后上传归档'}
        >
          <Upload className="h-3 w-3" aria-hidden />
          {uploading ? '上传中…' : shot.finalVideo ? '换成品' : '传成品'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        hidden
        onChange={(e) => void onUploadVideo(e)}
      />
      {shot.finalVideo && (
        <video
          src={duanjuFileUrl(workId, shot.finalVideo.path)}
          controls
          playsInline
          preload="metadata"
          className="mt-2 aspect-video w-full rounded-lg border border-[hsl(var(--border-soft))] bg-black"
          data-testid="shot-final-video"
        />
      )}
    </div>
  );
}
