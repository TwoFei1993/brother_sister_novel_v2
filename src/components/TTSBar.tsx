import React from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, Square, SkipBack, SkipForward, Mic } from 'lucide-react';
import { TTSVoiceType, VOICES } from '@/hooks/useEasyTTS';

interface TTSBarProps {
  isPlaying: boolean;
  isLoading?: boolean;
  rate: number;
  voiceType: TTSVoiceType;
  onPlayPause: () => void;
  onStop: () => void;
  onRateChange: (rate: number) => void;
  onVoiceChange: (voice: TTSVoiceType) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  visible: boolean;
}

const rates = [0.8, 1, 1.2, 1.5, 1.8, 2.0];

// 触控区域扩展常量
const ICON_BUTTON_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

// 声音列表
const voiceOptions = Object.values(VOICES).map(v => ({
  id: v.id,
  label: v.name,
  gender: v.gender
}));

export function TTSBar({
  isPlaying, isLoading, rate, voiceType, onPlayPause, onStop,
  onRateChange, onVoiceChange, onPrevChapter, onNextChapter, visible
}: TTSBarProps) {
  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-sm border-t border-border flex items-center justify-between px-2 sm:px-4 gap-1 sm:gap-3 h-14 sm:h-12 pb-safe">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={onPrevChapter} className="h-9 w-9 sm:h-8 sm:w-8" title="上一章" hitSlop={ICON_BUTTON_HIT_SLOP}>
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onPlayPause}
          className="h-9 w-9 sm:h-8 sm:w-8"
          title={isPlaying ? '暂停' : '播放'}
          disabled={isLoading}
          hitSlop={ICON_BUTTON_HIT_SLOP}
        >
          {isLoading ? (
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button variant="ghost" size="icon" onClick={onStop} className="h-9 w-9 sm:h-8 sm:w-8" title="停止" hitSlop={ICON_BUTTON_HIT_SLOP}>
          <Square className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onNextChapter} className="h-9 w-9 sm:h-8 sm:w-8" title="下一章" hitSlop={ICON_BUTTON_HIT_SLOP}>
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto pr-1">
        {/* Voice selector */}
        <div className="flex items-center gap-1">
          <Mic className="h-3 w-3 text-muted-foreground hidden sm:block shrink-0" />
          {voiceOptions.map(v => (
            <button
              key={v.id}
              onClick={() => onVoiceChange(v.id)}
              className={`text-xs px-2 py-1.5 rounded whitespace-nowrap min-w-[40px] min-h-[36px] flex items-center justify-center ${
                voiceType === v.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground bg-secondary/30'
              }`}
              title={v.gender === 'female' ? '女声' : '男声'}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Speed selector */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] sm:text-xs text-muted-foreground hidden sm:inline shrink-0">速度</span>
          {rates.map(r => (
            <button
              key={r}
              onClick={() => onRateChange(r)}
              className={`text-xs px-1.5 py-1.5 rounded min-w-[36px] min-h-[36px] flex items-center justify-center ${
                rate === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground bg-secondary/30'
              }`}
            >
              {r}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
