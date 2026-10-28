/**
 * 移动创作页听书条：朗读当前章（MiniMax TTS 逐段合成顺序播放）
 *
 * - 音色：localStorage 'm-tts-voice'（默认少女婉婉）；「我的」资料分区可切换
 * - 播放中逐段推进；⏹ 停止即中止队列；卸载自动停止
 */
import { useEffect, useRef, useState } from 'react';

import type { Message } from '@shared/message';

type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };

/** 当前听书音色（localStorage 持久化） */
export function mobileTtsVoiceId(): string {
  try {
    return localStorage.getItem('m-tts-voice') ?? 'female-shaonv';
  } catch {
    return 'female-shaonv';
  }
}

interface Props {
  chapter: ChapterMsg & { paras: string[] };
  stopped: boolean;
  onStop: () => void;
}

export default function MobileTtsBar({ chapter, stopped, onStop }: Props) {
  const [playingIdx, setPlayingIdx] = useState(-1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = stopped;
    if (stopped) {
      audioRef.current?.pause();
      setPlayingIdx(-1);
    }
  }, [stopped]);

  useEffect(
    () => () => {
      stopRef.current = true;
      audioRef.current?.pause();
    },
    [],
  );

  async function playFrom(start: number): Promise<void> {
    stopRef.current = false;
    for (let i = start; i < chapter.paras.length; i += 1) {
      if (stopRef.current) return;
      setPlayingIdx(i);
      try {
        const res = await fetch('/api/tts/minimax', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: chapter.paras[i], voiceId: mobileTtsVoiceId() }),
        });
        if (!res.ok) throw new Error('TTS 请求失败');
        const blob = await res.blob();
        if (stopRef.current) return;
        await new Promise<void>((resolve, reject) => {
          const audio = new Audio(URL.createObjectURL(blob));
          audioRef.current = audio;
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('播放失败'));
          void audio.play();
        });
      } catch {
        if (stopRef.current) return;
        setPlayingIdx(-1);
        return;
      }
    }
    setPlayingIdx(-1);
  }

  function toggle(): void {
    if (playingIdx >= 0) {
      stopRef.current = true;
      audioRef.current?.pause();
      setPlayingIdx(-1);
    } else {
      void playFrom(0);
    }
  }

  return (
    <div className="mx-4 mb-2 flex items-center gap-2" data-testid="mobile-tts-bar">
      <button
        type="button"
        onClick={toggle}
        data-testid="mobile-tts-toggle"
        className={`h-9 shrink-0 rounded-xl border px-3 text-xs ${
          playingIdx >= 0
            ? 'border-[hsl(var(--danger))]/40 text-[hsl(var(--danger))]'
            : 'border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]'
        }`}
      >
        {playingIdx >= 0 ? '⏹ 停止朗读' : '🔊 听本章'}
      </button>
      {playingIdx >= 0 && (
        <span className="text-xs text-[hsl(var(--fg-muted))]" data-testid="mobile-tts-progress">
          第 {playingIdx + 1}/{chapter.paras.length} 段
        </span>
      )}
    </div>
  );
}
