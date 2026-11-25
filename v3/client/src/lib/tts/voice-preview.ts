/**
 * 音色试听（用户需求 2026-11-26：选声前先听一句）。
 *
 * 合成一句固定示例并播放，复用听书引擎的单段合成（MiniMax / Edge 双引擎路由只此一份）。
 * 同一时刻只播一个：再点正在播的那个 = 停止；点另一个 = 切过去。
 */
import { useSyncExternalStore } from 'react';

import { engineOf } from './mobile-cast';
import { synthParaUrl } from './tts-player';

export type VoicePreviewState =
  | { status: 'idle' }
  | { status: 'loading'; id: string }
  | { status: 'playing'; id: string };

const SAMPLE_TEXT = '你好，这是我的声音，很高兴为你朗读这个故事。';

let state: VoicePreviewState = { status: 'idle' };
/** 当前试听的音频与其来源 URL（blob URL 停止时必须 revoke，防内存泄漏） */
let current: { el: HTMLAudioElement; url: string } | null = null;
/** 令牌：每次开始/停止递增，迟到的合成结果与回调按令牌作废 */
let token = 0;
const listeners = new Set<() => void>();

function set(next: VoicePreviewState): void {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): VoicePreviewState {
  return state;
}

/** 试听状态（选声器的「播放中 / 加载中」标记消费） */
export function useVoicePreview(): VoicePreviewState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 非 React 场景读取试听状态（事件回调/测试断言） */
export function getVoicePreview(): VoicePreviewState {
  return state;
}

function release(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

function dropCurrent(): { el: HTMLAudioElement; url: string } | null {
  const c = current;
  if (!c) return null;
  current = null;
  c.el.onended = null;
  c.el.onerror = null;
  c.el.pause();
  release(c.url);
  return c;
}

/** 停止当前试听 */
export function stopVoicePreview(): void {
  token += 1;
  dropCurrent();
  if (state.status !== 'idle') set({ status: 'idle' });
}

/** 试听某音色；正在播（或正在加载）的就是它 → 停止。合成/播放失败抛人话错误 */
export async function previewVoice(castId: string): Promise<void> {
  if (state.status !== 'idle' && state.id === castId) {
    stopVoicePreview();
    return;
  }
  stopVoicePreview();
  const my = ++token;
  set({ status: 'loading', id: castId });
  let url: string;
  try {
    url = await synthParaUrl(SAMPLE_TEXT, castId, 1);
  } catch {
    if (my === token) set({ status: 'idle' });
    throw new Error(
      engineOf(castId) === 'minimax' ? '试听失败：语音服务暂时不可用' : '试听失败：免费语音服务未配置或连不上',
    );
  }
  if (my !== token) {
    release(url); // 等待期间已被新的试听取代
    return;
  }
  const el = new Audio(url);
  current = { el, url };
  set({ status: 'playing', id: castId });
  const finish = (): void => {
    if (my === token) set({ status: 'idle' });
    dropCurrent();
  };
  el.onended = finish;
  el.onerror = finish;
  try {
    await el.play();
  } catch {
    finish(); // 浏览器拦截了自动播放：状态复位，不留「播放中」假象
    throw new Error('浏览器拦截了播放，请再点一次试听');
  }
}
