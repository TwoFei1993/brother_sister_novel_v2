/**
 * 全局听书引擎（番茄式，反馈⑦：退出阅读页后续播 + 悬浮小窗控制）：
 *
 * - 模块级单例：音频与播放循环不随组件卸载停止（离开书页 → 右下角悬浮小窗继续）
 * - useSyncExternalStore 订阅快照；Reader/听书条/悬浮窗共用同一状态源
 * - 逐段合成（useMobileTts 同款双引擎路由：MiniMax 走服务端转发、Edge 走 easyvoice）
 * - 失败自动重试/跳段（连续 3 段失败停止并回调错误）；倍速 1/1.25/1.5/2（反馈⑤，持久化）
 */
import { useSyncExternalStore } from 'react';

import { useSettingsStore } from '../../stores/settings';
import { engineOf, routeMobileParas, synthVoiceOf, type MobileRoutedPara } from './mobile-cast';
import { NARRATOR_VOICE_KEY } from './voice-route';

// ---------- 状态 ----------

export interface PlayerBook {
  bookId: string;
  title: string;
  paras: readonly string[];
  voiceMap: Record<string, string>;
}

export interface PlayerSnapshot {
  bookId: string | null;
  title: string;
  paraCount: number;
  /** 当前段下标；-1=未在播 */
  idx: number;
  playing: boolean;
  speed: number;
}

const SPEED_KEY = 'reading-tts-speed';

function loadSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return [1, 1.25, 1.5, 2].includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

let state: PlayerSnapshot = { bookId: null, title: '', paraCount: 0, idx: -1, playing: false, speed: loadSpeed() };
const listeners = new Set<() => void>();

function set(patch: Partial<PlayerSnapshot>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot(): PlayerSnapshot {
  return state;
}

// ---------- 错误回调（Reader toast 注册） ----------

type ErrorSink = (message: string) => void;
let errorSink: ErrorSink | null = null;

export function setPlayerErrorSink(fn: ErrorSink | null): void {
  errorSink = fn;
}

function notifyError(message: string): void {
  errorSink?.(message);
}

// ---------- 合成与播放 ----------

function easyvoiceBase(): string {
  const url = useSettingsStore.getState().config?.ttsBaseUrl;
  return (typeof url === 'string' ? url : '').replace(/\/+$/, '');
}

/** 单段合成 → 可播放音频 URL（speed：MiniMax 走 speed 参数、Edge 走 rate 百分比） */
async function synthParaUrl(text: string, castId: string, speed: number): Promise<string> {
  if (engineOf(castId) === 'minimax') {
    const res = await fetch('/api/tts/minimax', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId: synthVoiceOf(castId), speed }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    return URL.createObjectURL(await res.blob());
  }
  const base = easyvoiceBase();
  if (!base) throw new Error('未配置 TTS 服务地址，请到设置页填写');
  const percent = Math.round((speed - 1) * 100);
  const res = await fetch(`${base}/api/v1/tts/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: synthVoiceOf(castId), rate: `${percent >= 0 ? '+' : ''}${percent}%` }),
  });
  if (!res.ok) throw new Error(`TTS 服务请求失败（${res.status}）`);
  const data = (await res.json()) as { success?: boolean; message?: string; data?: { audio?: string } };
  if (!data.success || !data.data?.audio) throw new Error(data.message || 'TTS 音频生成失败');
  const audio = data.data.audio;
  return /^https?:\/\//.test(audio) ? audio : `${base}${audio.startsWith('/') ? '' : '/'}${audio}`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

async function synthWithRetry(text: string, castId: string, speed: number, alive: () => boolean): Promise<string | null> {
  for (const delay of [0, 1000, 3000]) {
    if (delay) await sleep(delay);
    if (!alive()) return null;
    try {
      return await synthParaUrl(text, castId, speed);
    } catch {
      /* 退避后重试 */
    }
  }
  return null;
}

let audioRef: { current: HTMLAudioElement | null } = { current: null };
let token = 0;
let currentBook: PlayerBook | null = null;
let routed: MobileRoutedPara[] = [];

function aliveOf(my: number): boolean {
  return token === my;
}

function playUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audioRef.current = audio;
    let settled = false;
    const settle = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    audio.onended = settle;
    audio.onpause = settle;
    audio.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error('播放失败'));
      }
    };
    void audio.play();
  });
}

/** 从 fromIdx 起播（token 作废旧循环） */
function runLoop(fromIdx: number): void {
  const my = ++token;
  const alive = (): boolean => aliveOf(my);
  if (!currentBook) return;
  audioRef.current?.pause();
  routed = routeMobileParas(currentBook.paras, currentBook.voiceMap);
  set({ idx: fromIdx, playing: true, paraCount: currentBook.paras.length });
  void (async () => {
    let consecutiveFailures = 0;
    for (let i = Math.max(0, fromIdx); i < routed.length; i += 1) {
      if (!alive()) return;
      set({ idx: i, playing: true });
      const url = await synthWithRetry(routed[i]!.text, routed[i]!.voice, state.speed, alive);
      if (!alive()) return;
      if (!url) {
        consecutiveFailures += 1;
        notifyError(`第 ${i + 1} 段合成失败，已跳过`);
        if (consecutiveFailures >= 3) {
          set({ playing: false });
          notifyError('连续多段合成失败，已停止听书（请稍后重试）');
          return;
        }
        continue;
      }
      consecutiveFailures = 0;
      try {
        await playUrl(url);
        if (!alive()) return;
      } catch {
        if (!alive()) return;
        notifyError(`第 ${i + 1} 段播放失败，已跳过`);
      }
    }
    if (alive()) {
      // 整本播完：清空悬浮窗（与番茄一致，播完即收）
      set({ bookId: null, idx: -1, playing: false });
    }
  })();
}

// ---------- 公开控制 ----------

export function playerStart(book: PlayerBook, fromIdx = 0): void {
  const sameBook = currentBook?.bookId === book.bookId;
  currentBook = book;
  if (sameBook) {
    playerSeek(fromIdx);
    return;
  }
  runLoop(fromIdx);
}

export function playerStop(): void {
  token += 1;
  audioRef.current?.pause();
  currentBook = null;
  set({ bookId: null, idx: -1, playing: false });
}

export function playerPause(): void {
  token += 1;
  audioRef.current?.pause();
  set({ playing: false });
}

export function playerResume(): void {
  if (state.playing || !currentBook) return;
  runLoop(Math.max(0, state.idx));
}

export function playerSeek(idx: number): void {
  if (!currentBook) return;
  runLoop(idx);
}

export function playerSetSpeed(speed: number): void {
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    /* 静默 */
  }
  set({ speed });
  if (state.playing) runLoop(Math.max(0, state.idx)); // 播放中即时生效（从当前段重合成）
}

/** 当前书上下文的旁白/缺省声兜底（引擎路由用 voiceMap，缺 narrator 键走默认主持人女） */
export function playerCurrentBookId(): string | null {
  return currentBook?.bookId ?? null;
}

// ---------- 调试出口（控制台：__ttsPlayer.snapshot 实时状态） ----------

if (typeof window !== 'undefined') {
  (window as unknown as { __ttsPlayer: object }).__ttsPlayer = {
    get snapshot() {
      return state;
    },
    get hasBook() {
      return currentBook !== null;
    },
  };
}

// ---------- React 绑定 ----------

export function usePlayerSnapshot(): PlayerSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 绑定某本书的播放视图（Reader 听书条/悬浮窗共用）：
 * 快照属于本书时返回实况，否则返回空闲态；playFrom 在非本书/未启动时自动 start（跨书安全）。
 */
export function useBookPlayer(book: PlayerBook | null) {
  const snap = usePlayerSnapshot();
  const mine = !!book && snap.bookId !== null && snap.bookId === book.bookId;
  return {
    playingIdx: mine ? snap.idx : -1,
    playing: mine && snap.playing,
    paraCount: mine ? snap.paraCount : 0,
    speed: snap.speed,
    stop: playerStop,
    playFrom: (i: number): void => {
      if (!book) return;
      if (currentBook?.bookId === book.bookId) playerSeek(i);
      else playerStart(book, i);
    },
  };
}
