import { useState, useCallback, useRef, useEffect } from 'react';

export type TTSVoiceType = string;

// 可用的中文声音列表
export const VOICES = {
  // 女声
  'xiaoxiao': { id: 'xiaoxiao', name: '晓晓', voice: 'zh-CN-XiaoxiaoNeural', gender: 'female' },
  'xiaoyi': { id: 'xiaoyi', name: '小艺', voice: 'zh-CN-XiaoyiNeural', gender: 'female' },
  'xiaobei': { id: 'xiaobei', name: '小贝', voice: 'zh-CN-liaoning-XiaobeiNeural', gender: 'female' },
  // 男声
  'yunxi': { id: 'yunxi', name: '云希', voice: 'zh-CN-YunxiNeural', gender: 'male' },
  'yunjian': { id: 'yunjian', name: '云健', voice: 'zh-CN-YunjianNeural', gender: 'male' },
  'yunyang': { id: 'yunyang', name: '云扬', voice: 'zh-CN-YunyangNeural', gender: 'male' },
};

// 默认声音
const DEFAULT_VOICE = 'xiaoxiao';

// 使用环境变量或默认地址
// 开发环境用 /api/v1/tts (通过 Vite 代理)
// 生产环境用公网地址
const EASYVOICE_API = import.meta.env.VITE_EASYVOICE_API || 'https://api.brothersisterhome.cloud/api/v1/tts';

export function useEasyTTS(onChapterEnd?: () => void) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rate, setRate] = useState(1);
  const [currentParagraph, setCurrentParagraph] = useState(-1);
  const [selectedParagraph, setSelectedParagraph] = useState(-1);
  const [voiceType, setVoiceType] = useState<TTSVoiceType>(DEFAULT_VOICE);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const paragraphsRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
  const rateRef = useRef(rate);
  const voiceTypeRef = useRef(voiceType);
  const onChapterEndRef = useRef(onChapterEnd);
  const isPausedRef = useRef(false);

  // 预加载缓存
  const preloadCacheRef = useRef<Map<string, string>>(new Map());
  const isPreloadingRef = useRef(false);

  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { voiceTypeRef.current = voiceType; }, [voiceType]);
  useEffect(() => { onChapterEndRef.current = onChapterEnd; }, [onChapterEnd]);

  // Convert rate (0.8-2.0) to easyVoice format (+/-X%)
  const convertRate = useCallback((userRate: number) => {
    const percent = Math.round((userRate - 1) * 100);
    return `${percent >= 0 ? '+' : ''}${percent}%`;
  }, []);

  // 生成缓存 key
  const getCacheKey = useCallback((text: string, voice: string, rateValue: string) => {
    return `${voice}_${rateValue}_${text.slice(0, 50)}`;
  }, []);

  // 预加载下一段音频
  const preloadNextAudio = useCallback(async (nextIndex: number) => {
    if (nextIndex >= paragraphsRef.current.length) return;

    const nextText = paragraphsRef.current[nextIndex];
    if (!nextText?.trim()) return;

    const voiceConfig = VOICES[voiceTypeRef.current as keyof typeof VOICES] || VOICES[DEFAULT_VOICE];
    const voice = voiceConfig.voice;
    const rateValue = convertRate(rateRef.current);
    const cacheKey = getCacheKey(nextText, voice, rateValue);

    // 检查缓存
    if (preloadCacheRef.current.has(cacheKey)) return;

    // 检查是否正在预加载
    if (isPreloadingRef.current) return;

    isPreloadingRef.current = true;
    try {
      const response = await fetch(`${EASYVOICE_API}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: nextText,
          voice,
          rate: rateValue,
          pitch: '+0Hz',
          volume: '+0%',
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          preloadCacheRef.current.set(cacheKey, result.data.audio);
        }
      }
    } catch (e) {
      // 预加载失败，静默处理
    } finally {
      isPreloadingRef.current = false;
    }
  }, [convertRate, getCacheKey]);

  // Fetch audio from easyVoice API
  const fetchAudio = useCallback(async (text: string, voice: string): Promise<string> => {
    const rateValue = convertRate(rateRef.current);
    const cacheKey = getCacheKey(text, voice, rateValue);

    // 先检查缓存
    const cached = preloadCacheRef.current.get(cacheKey);
    if (cached) {
      preloadCacheRef.current.delete(cacheKey); // 使用后删除
      return cached;
    }

    const response = await fetch(`${EASYVOICE_API}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voice,
        rate: rateValue,
        pitch: '+0Hz',
        volume: '+0%',
      }),
    });

    if (!response.ok) {
      throw new Error(`TTS API error: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || 'Failed to generate audio');
    }

    return result.data.audio;
  }, [convertRate, getCacheKey]);

  // Play a single paragraph
  const playParagraph = useCallback(async (index: number) => {
    if (index >= paragraphsRef.current.length) {
      setIsPlaying(false);
      setCurrentParagraph(-1);
      currentIndexRef.current = 0;
      onChapterEndRef.current?.();
      return;
    }

    const text = paragraphsRef.current[index];
    if (!text.trim()) {
      currentIndexRef.current = index + 1;
      playParagraph(index + 1);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const voiceConfig = VOICES[voiceTypeRef.current as keyof typeof VOICES] || VOICES[DEFAULT_VOICE];
      const voice = voiceConfig.voice;
      const audioUrl = await fetchAudio(text, voice);

      // Clean up previous audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }

      // Create new audio element
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onplay = () => {
        setIsLoading(false);
        setIsPlaying(true);
        setCurrentParagraph(index);
        currentIndexRef.current = index;

        // 预加载下一段
        preloadNextAudio(index + 1);
      };

      audio.onended = () => {
        playParagraph(index + 1);
      };

      audio.onerror = () => {
        setIsLoading(false);
        setIsPlaying(false);
        setError('音频播放失败');
      };

      await audio.play();
    } catch (err) {
      setIsLoading(false);
      setIsPlaying(false);
      setError(err instanceof Error ? err.message : '生成音频失败');
    }
  }, [fetchAudio, preloadNextAudio]);

  // Include chapter titles in the paragraphs for TTS
  const parseTextForTTS = useCallback((text: string): string[] => {
    return text.split('\n').filter(p => p.trim()).map(p => {
      if (p.startsWith('# ')) return p.slice(2).trim();
      if (p.startsWith('## ')) return p.slice(3).trim();
      return p;
    });
  }, []);

  const play = useCallback((text: string, startIndex?: number) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    // 清空缓存
    preloadCacheRef.current.clear();
    isPausedRef.current = false;
    paragraphsRef.current = parseTextForTTS(text);
    const idx = startIndex ?? (selectedParagraph >= 0 ? selectedParagraph : 0);
    setIsPlaying(true);
    playParagraph(idx);
  }, [playParagraph, selectedParagraph, parseTextForTTS]);

  const pause = useCallback(() => {
    if (audioRef.current && isPlaying) {
      audioRef.current.pause();
      isPausedRef.current = true;
      setIsPlaying(false);
    }
  }, [isPlaying]);

  const resume = useCallback(async (text: string) => {
    if (isPausedRef.current) {
      isPausedRef.current = false;
      paragraphsRef.current = parseTextForTTS(text);
      setIsPlaying(true);

      const textToPlay = paragraphsRef.current[currentIndexRef.current];
      if (textToPlay) {
        try {
          setIsLoading(true);
          const voiceConfig = VOICES[voiceTypeRef.current as keyof typeof VOICES] || VOICES[DEFAULT_VOICE];
          const voice = voiceConfig.voice;
          const audioUrl = await fetchAudio(textToPlay, voice);

          if (audioRef.current) {
            audioRef.current.src = audioUrl;
            await audioRef.current.play();
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : '恢复播放失败');
        }
      }
    }
  }, [fetchAudio, parseTextForTTS]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    preloadCacheRef.current.clear();
    isPausedRef.current = false;
    setIsPlaying(false);
    setIsLoading(false);
    setCurrentParagraph(-1);
    setSelectedParagraph(-1);
    currentIndexRef.current = 0;
    setError(null);
  }, []);

  const selectParagraph = useCallback(async (index: number) => {
    setSelectedParagraph(index);
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      isPausedRef.current = false;
      await playParagraph(index);
    }
  }, [isPlaying, playParagraph]);

  const changeRate = useCallback((newRate: number) => {
    setRate(newRate);
    rateRef.current = newRate;
    // 清空缓存，因为速度变了
    preloadCacheRef.current.clear();
  }, []);

  const changeVoice = useCallback((v: TTSVoiceType) => {
    setVoiceType(v);
    voiceTypeRef.current = v;
    // 清空缓存，因为声音变了
    preloadCacheRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  return {
    isPlaying,
    isLoading,
    currentParagraph,
    selectedParagraph,
    rate,
    voiceType,
    error,
    play,
    pause,
    resume,
    stop,
    selectParagraph,
    changeRate,
    changeVoice,
  };
}
