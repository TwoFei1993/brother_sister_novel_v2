/**
 * TTS 播放引擎（设计 §7.3 / Task 29，移植旧站 useEasyTTS 核心算法）
 *
 * - 连播队列：startChapters 多章队列；段落顺序播放，章末自动进下一章，队尾复位
 * - 段落路由：lib/voice-route 按说话人选声（前缀/引号归属/旁白）
 * - 音频：POST {ttsBaseUrl}/api/v1/tts/generate（body {text, voice, rate}，rate 换算 +X%）
 *   → new Audio(url) 播放；ttsBaseUrl 读 settingsStore.config（GET /api/config 下发）
 * - 预取：播放第 n 段时预取第 n+1 段（跨章含首段）；缓存 key=voice_rate_文本前50字
 * - refreshPlayback：语速/旁白声即时切换——清缓存、（声变时）重路由、重播当前段
 * - 世代 token：stop/start/refresh 递增使旧异步回调（fetch 返回、onended）全部失效
 *
 * 引擎与 React 解耦：createTtsEngine 为纯工厂（测试直接驱动），useTts 为 hook 薄壳。
 */
import { useMemo } from 'react';

import {
  NARRATOR_VOICE_KEY,
  routeParagraphs,
  voiceIdToName,
  type RoutedParagraph,
  type SpeakerBinding,
} from '../lib/tts/voice-route';
import { useSettingsStore } from '../stores/settings';
import { useTtsStore } from '../stores/tts';

/** 连播队列的章输入：text 全章正文；绑定与旁白声缺省走全局 */
export interface TtsChapterInput {
  text: string;
  /** 本章剧情指令（novel 闲聊前导剥离的回显判定用；chat 队列不传） */
  directive?: string;
  /** 作品级角色绑定（角色名 → 声音 id） */
  voiceMap?: Record<string, string>;
  /** 运行时补充说话人（如 chat 激活成员）；voiceMap 同名优先 */
  speakers?: SpeakerBinding[];
  /** 本章旁白声 id，缺省用 store.voice */
  defaultVoice?: string;
}

/** 单条点读选项（speakOne 用） */
export type TtsSpeakOptions = Omit<TtsChapterInput, 'text'>;

/** easyvoice /generate 响应（旧站形状 {success, data:{audio}}） */
interface TtsGenerateResponse {
  success?: boolean;
  message?: string;
  data?: { audio?: string };
}

/** 语速（0.8-2.0）→ easyvoice rate 字符串（+X% / -X%） */
export function convertRate(rate: number): string {
  const percent = Math.round((rate - 1) * 100);
  return `${percent >= 0 ? '+' : ''}${percent}%`;
}

/** 从 settingsStore 读 TTS 地址（去除尾斜杠；未配置为空串） */
function readTtsBaseUrl(): string {
  const url = useSettingsStore.getState().config?.ttsBaseUrl;
  return typeof url === 'string' ? url.replace(/\/+$/, '') : '';
}

/** 相对路径音频 URL 拼到 TTS 服务源（旧站 normalizeAudioUrl 移植） */
function normalizeAudioUrl(audio: string, base: string): string {
  if (/^https?:\/\//.test(audio)) return audio;
  return `${base}${audio.startsWith('/') ? '' : '/'}${audio}`;
}

export interface TtsEngine {
  /** 装入多章队列并从 fromChapter 开始连播（重入安全：旧队列作废） */
  startChapters(chapters: TtsChapterInput[], fromChapter?: number): void;
  /** 单条点读（chat 模式消息气泡） */
  speakOne(text: string, opts?: TtsSpeakOptions): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** 语速/旁白声变化后调用：清缓存；在播则（reroute=true 时先重路由）重播当前段 */
  refreshPlayback(reroute: boolean): void;
  nextChapter(): void;
  prevChapter(): void;
  /** 跳到指定章（越界忽略） */
  jumpTo(idx: number): void;
}

export function createTtsEngine(): TtsEngine {
  const queue: TtsChapterInput[] = [];
  let routed: RoutedParagraph[] = [];
  /** 世代标记：递增后旧 playParagraph 链的所有异步延续作废 */
  let token = 0;
  let audio: HTMLAudioElement | null = null;

  const store = () => useTtsStore.getState();

  function stopAudio(): void {
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio = null;
    }
  }

  function cacheKey(text: string, voiceName: string, rateValue: string): string {
    return `${voiceName}_${rateValue}_${text.slice(0, 50)}`;
  }

  /** 纯请求：POST /generate → 音频 URL（不读缓存；预取与实时播放共用） */
  async function requestAudio(text: string, voiceName: string, rateValue: string): Promise<string> {
    const base = readTtsBaseUrl();
    if (!base) throw new Error('未配置 TTS 服务地址，请到设置页填写');
    const res = await fetch(`${base}/api/v1/tts/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: voiceName, rate: rateValue }),
    });
    if (!res.ok) throw new Error(`TTS 服务请求失败（${res.status}）`);
    const data = (await res.json()) as TtsGenerateResponse;
    if (!data.success || !data.data?.audio) throw new Error(data.message || 'TTS 音频生成失败');
    return normalizeAudioUrl(data.data.audio, base);
  }

  /** 播放取声：缓存命中即取（用后删除），未命中现请求 */
  async function fetchAudio(text: string, voiceName: string): Promise<string> {
    const rateValue = convertRate(store().rate);
    const key = cacheKey(text, voiceName, rateValue);
    const cached = store().prefetchCache.get(key);
    if (cached) {
      store().prefetchCache.delete(key);
      return cached;
    }
    return requestAudio(text, voiceName, rateValue);
  }

  /** 预取：已缓存/已在预取则跳过，否则请求并填缓存（静默失败） */
  async function prefetch(chapterIdx: number, paraIdx: number): Promise<void> {
    const target = routedAt(chapterIdx, paraIdx);
    if (!target) return;
    const rateValue = convertRate(store().rate);
    const key = cacheKey(target.text, voiceIdToName(target.voice), rateValue);
    if (store().prefetchCache.has(key)) return;
    try {
      const url = await requestAudio(target.text, voiceIdToName(target.voice), rateValue);
      if (!store().prefetchCache.has(key)) store().prefetchCache.set(key, url);
    } catch {
      // 预取失败静默：正式播放时再请求
    }
  }

  /** 章的旁白声：显式入参 > voiceMap.narrator 约定键 > 全局 store.voice */
  function narratorVoiceOf(ch: TtsChapterInput): string {
    return ch.defaultVoice ?? (ch.voiceMap?.[NARRATOR_VOICE_KEY] || store().voice);
  }

  /** 取队列中某章某段（当前章走已路由缓存；其他章现路由一次） */
  function routedAt(chapterIdx: number, paraIdx: number): RoutedParagraph | null {
    const ch = queue[chapterIdx];
    if (!ch) return null;
    if (chapterIdx === store().chapterIndex && routed.length > 0) return routed[paraIdx] ?? null;
    return routeParagraphs(ch.text, ch.voiceMap ?? {}, ch.speakers ?? [], narratorVoiceOf(ch))[paraIdx] ?? null;
  }

  function routeChapter(idx: number): RoutedParagraph[] {
    const ch = queue[idx];
    return routeParagraphs(ch.text, ch.voiceMap ?? {}, ch.speakers ?? [], narratorVoiceOf(ch));
  }

  /** 进入指定章并从第 0 段开播 */
  function playChapter(idx: number): void {
    const ch = queue[idx];
    if (!ch) {
      store().patch({ playing: false, loading: false, currentIndex: -1 });
      return;
    }
    routed = routeChapter(idx);
    store().patch({ paragraphs: routed, chapterIndex: idx });
    void playParagraph(idx, 0);
  }

  /** 播放指定段；段末递归推进，章末进下一章，队尾复位 */
  async function playParagraph(chapterIdx: number, paraIdx: number): Promise<void> {
    const my = token;
    if (paraIdx >= routed.length || !queue[chapterIdx]) {
      const next = chapterIdx + 1;
      if (queue[next]) return playChapter(next);
      store().patch({ playing: false, loading: false, currentIndex: -1 });
      return;
    }
    const para = routed[paraIdx];
    try {
      store().patch({ loading: true, error: null });
      const url = await fetchAudio(para.text, voiceIdToName(para.voice));
      if (my !== token) return;
      stopAudio();
      const el = new Audio(url);
      audio = el;
      el.onended = () => {
        if (my !== token) return;
        void playParagraph(chapterIdx, paraIdx + 1);
      };
      el.onerror = () => {
        if (my !== token) return;
        store().patch({ playing: false, loading: false, error: '音频播放失败' });
      };
      await el.play();
      if (my !== token) return;
      store().patch({ playing: true, loading: false, chapterIndex: chapterIdx, currentIndex: paraIdx });
      void prefetch(chapterIdx, paraIdx + 1);
    } catch (err) {
      if (my !== token) return;
      store().patch({
        playing: false,
        loading: false,
        error: err instanceof Error ? err.message : '音频生成失败',
      });
    }
  }

  return {
    startChapters(chapters, fromChapter = 0) {
      token += 1;
      stopAudio();
      store().clearCache();
      queue.length = 0;
      queue.push(...chapters);
      store().patch({ chapterCount: chapters.length, error: null });
      playChapter(fromChapter);
    },

    speakOne(text, opts = {}) {
      this.startChapters([{ text, ...opts }]);
    },

    pause() {
      audio?.pause();
      store().patch({ playing: false });
    },

    resume() {
      const el = audio;
      if (!el) return;
      store().patch({ playing: true });
      void el.play().catch(() => store().patch({ playing: false, error: '恢复播放失败' }));
    },

    stop() {
      token += 1;
      stopAudio();
      queue.length = 0;
      routed = [];
      useTtsStore.getState().reset();
    },

    refreshPlayback(reroute) {
      token += 1;
      stopAudio();
      store().clearCache();
      if (!store().playing && !store().loading) return;
      const { chapterIndex, currentIndex } = store();
      if (reroute && queue[chapterIndex]) {
        routed = routeChapter(chapterIndex);
        store().patch({ paragraphs: routed });
      }
      void playParagraph(chapterIndex, Math.max(currentIndex, 0));
    },

    nextChapter() {
      this.jumpTo(store().chapterIndex + 1);
    },

    prevChapter() {
      this.jumpTo(store().chapterIndex - 1);
    },

    jumpTo(idx: number) {
      if (idx < 0 || idx >= queue.length) return;
      token += 1;
      stopAudio();
      store().clearCache();
      playChapter(idx);
    },
  } satisfies TtsEngine;
}

/**
 * useTts：TTS 播放 hook（挂载契约）
 *
 * - ReadingView/WorkPage（novel 底部条）：
 *   `engine.startChapters(messages.filter(m => m.chapter).map(m => ({ text: m.content, voiceMap: work.voiceMap })))`
 *   TtsBar 的上一章/下一章接 `engine.prevChapter()/nextChapter()`；
 *   当前段高亮读 `chapterIndex/currentIndex`。
 * - ChatView 单条点读：`engine.speakOne(message.content, { voiceMap: work.voiceMap, speakers })`。
 */
export function useTts(): { engine: TtsEngine } & ReturnType<typeof useTtsStore.getState> {
  const engine = useMemo(() => createTtsEngine(), []);
  const view = useTtsStore();
  return { engine, ...view };
}
