import React from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, Square, SkipBack, SkipForward, Mic } from 'lucide-react';
import { TTSVoiceType } from '@/hooks/useTTS';

interface TTSBarProps {
  isPlaying: boolean;
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

const rates = [0.8, 1, 1.2, 1.5];
const voices: { id: TTSVoiceType; label: string }[] = [
  { id: 'female', label: '女声' },
  { id: 'male', label: '男声' },
  { id: 'default', label: '默认' },
];

export function TTSBar({
  isPlaying, rate, voiceType, onPlayPause, onStop,
  onRateChange, onVoiceChange, onPrevChapter, onNextChapter, visible
}: TTSBarProps) {
  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-sm border-t border-border flex items-center justify-between px-2 sm:px-4 gap-1 sm:gap-3 h-11 sm:h-12">
      <div className="flex items-center gap-0.5 sm:gap-1">
        <Button variant="ghost" size="icon" onClick={onPrevChapter} className="h-7 w-7 sm:h-8 sm:w-8" title="上一章">
          <SkipBack className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onPlayPause} className="h-7 w-7 sm:h-8 sm:w-8" title={isPlaying ? '暂停' : '播放'}>
          {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
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
          {voices.map(v => (
            <button
              key={v.id}
              onClick={() => onVoiceChange(v.id)}
              className={`text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 rounded whitespace-nowrap ${
                voiceType === v.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
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
