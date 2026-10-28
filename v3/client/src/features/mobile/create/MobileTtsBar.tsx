/**
 * 移动创作页听书条：朗读当前章（按 voiceMap 分声路由 + 双引擎逐段合成顺序播放）
 *
 * - 音色：作品「资料」分区的配音面板（work.voiceMap），旁白/角色各归其声
 * - 播放中逐段推进并显示当前说话人；⏹ 停止即中止队列；卸载/切章自动停止
 */
import { useMemo } from 'react';

import { NARRATOR_SPEAKER } from '../../../lib/tts/voice-route';
import { routeMobileParas } from '../../../lib/tts/mobile-cast';
import { useMobileTts } from '../useMobileTts';
import type { Message } from '@shared/message';

type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };

interface Props {
  chapter: ChapterMsg;
  /** 作品级音色表（角色名/旁白 → 音色 id）；缺省全走旁白默认声 */
  voiceMap?: Record<string, string>;
}

export default function MobileTtsBar({ chapter, voiceMap }: Props) {
  const paras = useMemo(
    () =>
      chapter.content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== ''),
    [chapter.content],
  );
  const routedParas = useMemo(() => routeMobileParas(paras, voiceMap ?? {}), [paras, voiceMap]);
  const tts = useMobileTts(paras, voiceMap);
  const speaker = tts.playingIdx >= 0 ? routedParas[tts.playingIdx]?.speaker : undefined;

  function toggle(): void {
    if (tts.playing) tts.stop();
    else void tts.playFrom(0);
  }

  return (
    <div className="mx-4 mb-2 flex items-center gap-2" data-testid="mobile-tts-bar">
      <button
        type="button"
        onClick={toggle}
        data-testid="mobile-tts-toggle"
        className={`h-9 shrink-0 rounded-xl border px-3 text-xs ${
          tts.playing
            ? 'border-[hsl(var(--danger))]/40 text-[hsl(var(--danger))]'
            : 'border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]'
        }`}
      >
        {tts.playing ? '⏹ 停止朗读' : '🔊 听本章'}
      </button>
      {tts.playingIdx >= 0 && (
        <span className="text-xs text-[hsl(var(--fg-muted))]" data-testid="mobile-tts-progress">
          第 {tts.playingIdx + 1}/{paras.length} 段
          {speaker && speaker !== NARRATOR_SPEAKER ? ` · ${speaker}` : ''}
        </span>
      )}
    </div>
  );
}
