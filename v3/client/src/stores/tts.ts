/**
 * TTS 域 store（设计 §7.3 / Task 29）
 *
 * 承载播放器 UI 可见状态与预取缓存；播放引擎（useTts/hooks）经本 store 的
 * getState/setState 驱动，UI 组件只订阅本 store 渲染。
 * - prefetchCache：预取缓存 Map（key=voice_rate_文本前50字 → 音频 URL）。
 *   缓存为性能优化，原地读写、不触发订阅重渲染。
 * - voice 为旁白声 id（VOICES[].id）；角色声由 voiceMap 按段落路由（lib/voice-route）。
 */
import { create } from 'zustand';

import { DEFAULT_VOICE_ID, type RoutedParagraph } from '../lib/tts/voice-route';

/** 播放器 UI 可见状态（引擎 patch 的目标子集） */
export interface TtsView {
  /** 音频播放中（暂停/加载中为 false） */
  playing: boolean;
  /** 正在请求音频 */
  loading: boolean;
  /** 当前章在连播队列中的下标 */
  chapterIndex: number;
  /** 当前段在段落列表中的下标（-1 空闲/播完） */
  currentIndex: number;
  /** 当前章路由后段落（含每段声音） */
  paragraphs: RoutedParagraph[];
  /** 连播队列章数 */
  chapterCount: number;
  /** 旁白声 id */
  voice: string;
  /** 语速（0.8-2.0） */
  rate: number;
  error: string | null;
}

interface TtsState extends TtsView {
  /** 预取缓存（原地读写） */
  prefetchCache: Map<string, string>;
  patch: (partial: Partial<TtsView>) => void;
  setVoice: (id: string) => void;
  setRate: (rate: number) => void;
  clearCache: () => void;
  reset: () => void;
}

const INITIAL_VIEW: TtsView = {
  playing: false,
  loading: false,
  chapterIndex: 0,
  currentIndex: -1,
  paragraphs: [],
  chapterCount: 0,
  voice: DEFAULT_VOICE_ID,
  rate: 1,
  error: null,
};

export const useTtsStore = create<TtsState>()((set) => ({
  ...INITIAL_VIEW,
  prefetchCache: new Map<string, string>(),

  patch: (partial) => set(partial),
  setVoice: (id) => set({ voice: id }),
  setRate: (rate) => set({ rate }),
  clearCache: () => set({ prefetchCache: new Map<string, string>() }),
  reset: () => set({ ...INITIAL_VIEW, prefetchCache: new Map<string, string>() }),
}));
