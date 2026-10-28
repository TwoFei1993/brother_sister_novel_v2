/**
 * 移动端 TTS 播放 hook：逐段合成 + 顺序播放 + 停止/进度
 *
 * - 音色：localStorage 'm-tts-voice'（「我的」资料分区可切换）
 * - 逐段调 /api/tts/minimax 合成 mp3 → Audio 顺序播放
 * - 停止/切章自动中止队列
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface TtsState {
  playingIdx: number;
  playing: boolean;
}

export function useMobileTts(paras: readonly string[]) {
  const [tts, setTts] = useState<TtsState>({ playingIdx: -1, playing: false });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopRef = useRef(false);
  const parasRef = useRef(paras);
  parasRef.current = paras;

  const stop = useCallback(() => {
    stopRef.current = true;
    audioRef.current?.pause();
    setTts({ playingIdx: -1, playing: false });
  }, []);

  useEffect(
    () => () => {
      stopRef.current = true;
      audioRef.current?.pause();
    },
    [],
  );

  const playFrom = useCallback(
    async (start: number, voiceId: string): Promise<void> => {
      stopRef.current = false;
      const list = parasRef.current;
      for (let i = start; i < list.length; i += 1) {
        if (stopRef.current) return;
        setTts((s) => ({ ...s, playingIdx: i, playing: true }));
        try {
          const res = await fetch('/api/tts/minimax', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: list[i], voiceId }),
          });
          if (!res.ok) throw new Error(`TTS ${res.status}`);
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
          setTts((s) => ({ ...s, playingIdx: -1, playing: false }));
          return;
        }
      }
      setTts({ playingIdx: -1, playing: false });
    },
    [parasRef],
  );

  return { ...tts, stop, playFrom };
}
