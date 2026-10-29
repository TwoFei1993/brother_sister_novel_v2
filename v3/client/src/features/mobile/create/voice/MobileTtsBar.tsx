/**
 * 移动创作页听书条：朗读当前章（按 voiceMap 分声路由 + 双引擎逐段合成顺序播放）
 * 播放走全局听书引擎（番茄式）：离开本书后台续播，悬浮窗可控。
 */
import { useMemo } from 'react';

import { NARRATOR_SPEAKER } from '../../../../lib/tts/voice-route';
import { routeMobileParas } from '../../../../lib/tts/mobile-cast';
import { playerStart, playerStop, useBookPlayer } from '../../../../lib/tts/tts-player';
import type { Message } from '@shared/message';

type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };

interface Props {
  bookId: string;
  bookTitle: string;
  chapter: ChapterMsg;
  /** 作品级音色表（角色名/旁白 → 音色 id）；缺省全走旁白默认声 */
  voiceMap?: Record<string, string>;
}

export default function MobileTtsBar({ bookId, bookTitle, chapter, voiceMap }: Props) {
  const paras = useMemo(
    () =>
      chapter.content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== ''),
    [chapter.content],
  );
  const routedParas = useMemo(() => routeMobileParas(paras, voiceMap ?? {}), [paras, voiceMap]);
  const book = useMemo(
    () => ({ bookId, title: bookTitle, paras, voiceMap: voiceMap ?? {} }),
    [bookId, bookTitle, paras, voiceMap],
  );
  const player = useBookPlayer(book);
  const speaker = player.playingIdx >= 0 ? routedParas[player.playingIdx]?.speaker : undefined;

  function toggle(): void {
    if (player.playing) playerStop();
    else playerStart(book, 0);
  }

  return (
    <div className="mx-4 mb-2 flex items-center gap-2" data-testid="mobile-tts-bar">
      <button
        type="button"
        onClick={toggle}
        data-testid="mobile-tts-toggle"
        className={`h-9 shrink-0 rounded-xl border px-3 text-xs ${
          player.playing
            ? 'border-[hsl(var(--danger))]/40 text-[hsl(var(--danger))]'
            : 'border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]'
        }`}
      >
        {player.playing ? '⏹ 停止朗读' : '🔊 听本章'}
      </button>
      {player.playingIdx >= 0 && (
        <span className="text-xs text-[hsl(var(--fg-muted))]" data-testid="mobile-tts-progress">
          第 {player.playingIdx + 1}/{paras.length} 段
          {speaker && speaker !== NARRATOR_SPEAKER ? ` · ${speaker}` : ''}
        </span>
      )}
    </div>
  );
}
