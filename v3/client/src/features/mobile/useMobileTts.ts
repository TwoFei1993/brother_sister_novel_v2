/**
 * 移动端 TTS 播放 hook：按说话人路由音色 + 双引擎逐段合成 + 顺序播放
 *
 * - 音色来源：work.voiceMap（「资料」分区配音面板配置；旁白取 narrator 键）
 * - 引擎：MiniMax 音色走 /api/tts/minimax（服务端转发）；Edge 免费音色走 easyvoice（设置页地址）
 * - 逐段合成 mp3 → Audio 顺序播放；playFrom 可在播放中跳段（世代令牌作废旧队列）
 * - 段落变化（切章/改正文）自动停止；卸载自动停止
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSettingsStore } from '../../stores/settings';
import { engineOf, routeMobileParas, synthVoiceOf, type MobileRoutedPara } from '../../lib/tts/mobile-cast';

interface TtsState {
  playingIdx: number;
  playing: boolean;
}

/** easyvoice /generate 响应（旧站形状 {success, data:{audio}}） */
interface EasyvoiceResponse {
  success?: boolean;
  message?: string;
  data?: { audio?: string };
}

/** 设置页配置的 easyvoice 服务地址（去尾斜杠） */
function easyvoiceBase(): string {
  const url = useSettingsStore.getState().config?.ttsBaseUrl;
  return (typeof url === 'string' ? url : '').replace(/\/+$/, '');
}

/** 单段合成 → 可播放的音频 URL（MiniMax 二进制转 blob URL；easyvoice 直返音频地址） */
async function synthParaUrl(text: string, castId: string): Promise<string> {
  if (engineOf(castId) === 'minimax') {
    const res = await fetch('/api/tts/minimax', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId: synthVoiceOf(castId) }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    return URL.createObjectURL(await res.blob());
  }
  const base = easyvoiceBase();
  if (!base) throw new Error('未配置 TTS 服务地址，请到设置页填写');
  const res = await fetch(`${base}/api/v1/tts/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: synthVoiceOf(castId), rate: '+0%' }),
  });
  if (!res.ok) throw new Error(`TTS 服务请求失败（${res.status}）`);
  const data = (await res.json()) as EasyvoiceResponse;
  if (!data.success || !data.data?.audio) throw new Error(data.message || 'TTS 音频生成失败');
  const audio = data.data.audio;
  return /^https?:\/\//.test(audio) ? audio : `${base}${audio.startsWith('/') ? '' : '/'}${audio}`;
}

/** 等一段播完（pause 也解除等待，供停止/跳段及时退出） */
function playUrl(audioRef: { current: HTMLAudioElement | null }, url: string): Promise<void> {
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

export function useMobileTts(
  paras: readonly string[],
  voiceMap?: Record<string, string>,
  onError?: (message: string) => void,
) {
  const [tts, setTts] = useState<TtsState>({ playingIdx: -1, playing: false });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** 世代令牌：跳段/停止后旧播放链的所有异步延续作废 */
  const tokenRef = useRef(0);
  const parasRef = useRef(paras);
  parasRef.current = paras;
  const castRef = useRef(voiceMap);
  castRef.current = voiceMap;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const stop = useCallback(() => {
    tokenRef.current += 1;
    audioRef.current?.pause();
    setTts((s) => (s.playing || s.playingIdx >= 0 ? { playingIdx: -1, playing: false } : s));
  }, []);

  // 段落变化（切章/改正文）自动停止
  useEffect(() => {
    stop();
  }, [paras, stop]);

  useEffect(
    () => () => {
      tokenRef.current += 1;
      audioRef.current?.pause();
    },
    [],
  );

  const playFrom = useCallback(async (start: number): Promise<void> => {
    const token = (tokenRef.current += 1);
    audioRef.current?.pause();
    const routed: readonly MobileRoutedPara[] = routeMobileParas(parasRef.current, castRef.current ?? {});
    for (let i = Math.max(0, start); i < routed.length; i += 1) {
      if (tokenRef.current !== token) return;
      setTts({ playingIdx: i, playing: true });
      try {
        const url = await synthParaUrl(routed[i]!.text, routed[i]!.voice);
        if (tokenRef.current !== token) return;
        await playUrl(audioRef, url);
        if (tokenRef.current !== token) return;
      } catch (err) {
        if (tokenRef.current !== token) return;
        setTts({ playingIdx: -1, playing: false });
        onErrorRef.current?.(err instanceof Error ? err.message : '未知错误');
        return;
      }
    }
    if (tokenRef.current === token) setTts({ playingIdx: -1, playing: false });
  }, []);

  return { ...tts, stop, playFrom };
}
