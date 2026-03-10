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
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-sm border-t border-border flex items-center justify-between px-2 sm:px-4 gap-1 sm:gap-3 h-11 sm:h-12">
      <div className="flex items-center gap-0.5 sm:gap-1">
        <Button variant="ghost" size="icon" onClick={onPrevChapter} className="h-7 w-7 sm:h-8 sm:w-8" title="上一章">
          <SkipBack className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onPlayPause}
          className="h-7 w-7 sm:h-8 sm:w-8"
          title={isPlaying ? '暂停' : '播放'}
          disabled={isLoading}
        >
          {isLoading ? (
            <div className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3" />
          )}
        </Button>
        <Button variant="ghost" size="icon" onClick={onStop} className="h-7 w-7 sm:h-8 sm:w-8" title="停止">
          <Square className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onNextChapter} className="h-7 w-7 sm:h-8 sm:w-8" title="下一章">
          <SkipForward className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex items-center gap-1 sm:gap-3 overflow-x-auto">
        {/* Voice selector */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          <Mic className="h-3 w-3 text-muted-foreground hidden sm:block" />
          {voiceOptions.map(v => (
            <button
              key={v.id}
              onClick={() => onVoiceChange(v.id)}
              className={`text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 rounded whitespace-nowrap ${
                voiceType === v.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              title={v.gender === 'female' ? '女声' : '男声'}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Speed selector */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          <span className="text-[10px] sm:text-xs text-muted-foreground hidden sm:inline">速度</span>
          {rates.map(r => (
            <button
              key={r}
              onClick={() => onRateChange(r)}
              className={`text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 rounded ${
                rate === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
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
