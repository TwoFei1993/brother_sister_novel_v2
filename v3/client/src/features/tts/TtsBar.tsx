/**
 * TTS 底部控制条（旧站 TTSBar 移植 + 分声改造）
 *
 * 布局：上一章 / 播放⏸ / 停止 / 下一章 + 旁白声下拉（6 声）+ 语速 6 档。
 * 状态与动作全部由 props 注入（引擎经 useTts 提供，本组件不直接持有引擎），
 * 播放推进时经 onParagraphChange 向宿主上报当前段（章节内段落下标）供正文高亮。
 */
import { useEffect } from 'react';

import { VOICES } from '../../lib/voice-route';

/** 语速 6 档（对齐旧站 rates） */
export const TTS_RATES = [0.8, 1, 1.2, 1.5, 1.8, 2.0] as const;

interface TtsBarProps {
  playing: boolean;
  /** 音频请求中（播放键转圈） */
  loading?: boolean;
  /** 当前章下标（0-based） */
  chapterIndex: number;
  /** 连播队列总章数 */
  chapterCount: number;
  /** 当前段下标（-1 空闲；变化时触发 onParagraphChange） */
  currentIndex?: number;
  /** 旁白声 id（VOICES[].id） */
  voice: string;
  rate: number;
  visible?: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onRateChange: (rate: number) => void;
  onVoiceChange: (voiceId: string) => void;
  /** 当前段高亮回调：段推进/复位时上报（-1 表示空闲） */
  onParagraphChange?: (chapterIndex: number, paragraphIndex: number) => void;
}

const barBtn =
  'flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm text-[hsl(var(--fg-muted))] transition-colors hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--fg))] disabled:cursor-not-allowed disabled:opacity-40';

const rateBtn = (active: boolean) =>
  `min-h-[36px] min-w-[40px] rounded px-1.5 text-xs transition-colors ${
    active
      ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]'
      : 'text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--surface))]'
  }`;

export default function TtsBar({
  playing,
  loading = false,
  chapterIndex,
  chapterCount,
  currentIndex = -1,
  voice,
  rate,
  visible = true,
  onPlayPause,
  onStop,
  onPrevChapter,
  onNextChapter,
  onRateChange,
  onVoiceChange,
  onParagraphChange,
}: TtsBarProps) {
  // 当前段推进上报（供宿主正文高亮）
  useEffect(() => {
    onParagraphChange?.(chapterIndex, currentIndex);
  }, [chapterIndex, currentIndex, onParagraphChange]);

  if (!visible) return null;
  const hasPrev = chapterIndex > 0;
  const hasNext = chapterIndex < chapterCount - 1;

  return (
    <div
      data-testid="tts-bar"
      className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-center justify-between gap-2 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-2 pb-[env(safe-area-inset-bottom)] sm:px-4"
    >
      {/* 章控制 */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="上一章"
          aria-label="上一章"
          data-testid="tts-prev"
          disabled={!hasPrev}
          onClick={onPrevChapter}
          className={barBtn}
        >
          ⏮
        </button>
        <button
          type="button"
          title={playing ? '暂停' : '播放'}
          aria-label={playing ? '暂停' : '播放'}
          data-testid="tts-play"
          disabled={loading}
          onClick={onPlayPause}
          className={barBtn}
        >
          {loading ? '…' : playing ? '⏸' : '▶'}
        </button>
        <button type="button" title="停止" aria-label="停止" data-testid="tts-stop" onClick={onStop} className={barBtn}>
          ⏹
        </button>
        <button
          type="button"
          title="下一章"
          aria-label="下一章"
          data-testid="tts-next"
          disabled={!hasNext}
          onClick={onNextChapter}
          className={barBtn}
        >
          ⏭
        </button>
        {chapterCount > 0 && (
          <span data-testid="tts-chapter-pos" className="ml-1 whitespace-nowrap text-xs text-[hsl(var(--fg-muted))]">
            {chapterIndex + 1}/{chapterCount}
          </span>
        )}
      </div>

      {/* 声音与语速 */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <label className="flex items-center gap-1 text-xs text-[hsl(var(--fg-muted))]">
          <span className="hidden sm:inline">旁白声</span>
          <select
            data-testid="tts-voice"
            aria-label="旁白声音"
            value={voice}
            onChange={(e) => onVoiceChange(e.target.value)}
            className="h-9 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-1.5 text-xs outline-none focus:border-[hsl(var(--accent))]"
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}（{v.gender === 'female' ? '女' : '男'}）
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-0.5">
          <span className="mr-0.5 hidden text-xs text-[hsl(var(--fg-muted))] sm:inline">速度</span>
          {TTS_RATES.map((r) => (
            <button
              key={r}
              type="button"
              aria-label={`语速 ${r}x`}
              data-testid={`tts-rate-${r}`}
              onClick={() => onRateChange(r)}
              className={rateBtn(rate === r)}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
