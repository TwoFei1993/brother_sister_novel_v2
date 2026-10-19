/**
 * novel 模式 TTS 接线层（Task 29 挂载契约落地）：useTts 引擎 + TtsBar 宿主
 *
 * - 空闲首次播放 startChapters(全章队列)；播放中暂停 / 暂停中恢复；队尾播完再点从头重播
 * - 上一章/下一章接 engine.prev/nextChapter；语速变化 refreshPlayback(false)、
 *   旁白声变化 refreshPlayback(true)（重路由当前章）
 * - 卸载（离开作品页）engine.stop()，避免音频跨页续播
 * - 引擎常驻本组件（视图切换不卸载），A/B/C 三视图均显示控制条（用户反馈：写作时也要能听书）
 */
import { useEffect, useRef } from 'react';
import type { Work } from '@shared/work';

import { presentableNovel, splitOutline } from '../../engine/prompt/postprocess';
import { useTts, type TtsChapterInput } from '../../hooks/useTts';
import { useTtsStore } from '../../stores/tts';

import TtsBar from './TtsBar';

interface WorkTtsBarProps {
  work: Work;
  /** 连播队列（按章号升序；调用方与 ReadingView 的章序列保持同源同序） */
  chapters: TtsChapterInput[];
}

export default function WorkTtsBar({ work, chapters }: WorkTtsBarProps) {
  const { engine, playing, loading, chapterIndex, currentIndex, chapterCount, voice, rate, error } = useTts();
  /** 队列已启动标记：false=空闲（播放键=startChapters）；true 后播放键=pause/resume */
  const startedRef = useRef(false);

  // 离开作品页停止播放并复位（store 全局共享，不随组件卸载自动清）
  useEffect(() => () => engine.stop(), [engine]);

  function handlePlayPause(): void {
    if (playing) {
      engine.pause();
      return;
    }
    // 已启动且停在某段（暂停态）→ 恢复；空闲或队列已播完（currentIndex=-1）→ 重新装队
    if (startedRef.current && currentIndex >= 0) {
      engine.resume();
      return;
    }
    startedRef.current = true;
    // 朗读跳过头部要点提纲：每章先 splitOutline 取正文（与 ReadingView 高亮段落同源切分）
    engine.startChapters(
      chapters.map((c) => ({
        text: splitOutline(presentableNovel(c.text, c.directive)).body,
        voiceMap: work.voiceMap,
      })),
      currentIndex >= 0 ? chapterIndex : 0,
    );
  }

  function handleStop(): void {
    engine.stop();
    startedRef.current = false;
  }

  return (
    <>
      {error && (
        <p
          role="alert"
          className="border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--danger))]/10 px-3 py-1.5 text-xs text-[hsl(var(--danger))]"
        >
          朗读失败：{error}
        </p>
      )}
      <TtsBar
        playing={playing}
        loading={loading}
        chapterIndex={chapterIndex}
        chapterCount={chapterCount}
        currentIndex={currentIndex}
        voice={voice}
        rate={rate}
        visible={chapters.length > 0}
        onPlayPause={handlePlayPause}
        onStop={handleStop}
        onPrevChapter={() => engine.prevChapter()}
        onNextChapter={() => engine.nextChapter()}
        onRateChange={(r) => {
          useTtsStore.getState().setRate(r);
          engine.refreshPlayback(false);
        }}
        onVoiceChange={(id) => {
          useTtsStore.getState().setVoice(id);
          engine.refreshPlayback(true);
        }}
      />
    </>
  );
}
