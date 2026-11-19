/**
 * 移动创作页听书条：朗读当前章（按 voiceMap 分声路由 + 双引擎逐段合成顺序播放）
 * 播放走全局听书引擎（番茄式）：离开本书后台续播，悬浮窗可控。
 * 含定时停止（用户需求：熄屏听书场景配合）——15/30/45/60 分钟循环切换，到点自动暂停。
 */
import { useMemo } from 'react';

import { NARRATOR_SPEAKER } from '../../../../lib/tts/voice-route';
import { routeMobileParas } from '../../../../lib/tts/mobile-cast';
import { cycleSleepTimer, playerStart, playerStop, sleepRemainMs, useBookPlayer } from '../../../../lib/tts/tts-player';
import type { Message } from '@shared/message';

type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };

interface Props {
  bookId: string;
  bookTitle: string;
  chapter: ChapterMsg;
  /** 作品级音色表（角色名/旁白 → 音色 id）；缺省全走旁白默认声 */
  voiceMap?: Record<string, string>;
}

const SLEEP_STEPS = [0, 15, 30, 45, 60]; // 分钟；0=不定时

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
  // bookId 含章节 msgId（与阅读器同规则）：创作页切章后播放走 start 换 paras，不沿旧章内容
  const book = useMemo(
    () => ({ workId: bookId, bookId: `${bookId}:${chapter.id}`, title: bookTitle, paras, voiceMap: voiceMap ?? {} }),
    [bookId, bookTitle, chapter.id, paras, voiceMap],
  );
  const player = useBookPlayer(book);
  const speaker = player.playingIdx >= 0 ? routedParas[player.playingIdx]?.speaker : undefined;
  const remainMs = sleepRemainMs();
  const remainMin = remainMs === null ? null : Math.ceil(remainMs / 60000);

  function toggle(): void {
    if (player.playing) playerStop();
    else playerStart(book, 0);
  }

  /** 定时挡位循环（引擎层 cycleSleepTimer）：关→15→30→45→60→关 */
  function cycleSleep(): void {
    cycleSleepTimer();
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
      {(player.playingIdx >= 0 || player.paused) && (
        <>
          <span className="text-xs text-[hsl(var(--fg-muted))]" data-testid="mobile-tts-progress">
            第 {player.playingIdx + 1}/{paras.length} 段
            {speaker && speaker !== NARRATOR_SPEAKER ? ` · ${speaker}` : ''}
          </span>
          <button
            type="button"
            onClick={cycleSleep}
            data-testid="mobile-tts-sleep"
            title="定时停止：到点自动暂停（再点切换挡位，关=不定时）"
            className={`ml-auto h-9 shrink-0 rounded-xl border px-2.5 text-xs ${
              remainMin !== null && remainMin > 0
                ? 'border-[hsl(var(--accent))]/50 text-[hsl(var(--accent))]'
                : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
            }`}
          >
            ⏲ {remainMin !== null && remainMin > 0 ? `${remainMin} 分钟` : '定时'}
          </button>
        </>
      )}
    </div>
  );
}
