import { useState, useCallback, useRef, useEffect } from 'react';

export type TTSVoiceType = 'female' | 'male' | 'default';

export function useTTS(onChapterEnd?: () => void) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [currentParagraph, setCurrentParagraph] = useState(-1);
  const [selectedParagraph, setSelectedParagraph] = useState(-1);
  const [voiceType, setVoiceType] = useState<TTSVoiceType>('female');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const paragraphsRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
  const rateRef = useRef(rate);
  const voiceTypeRef = useRef(voiceType);
  const onChapterEndRef = useRef(onChapterEnd);
  const isPausedRef = useRef(false);

  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { voiceTypeRef.current = voiceType; }, [voiceType]);
  useEffect(() => { onChapterEndRef.current = onChapterEnd; }, [onChapterEnd]);

  // Preload voices
  useEffect(() => {
    speechSynthesis.getVoices();
    const handleVoices = () => speechSynthesis.getVoices();
    speechSynthesis.addEventListener('voiceschanged', handleVoices);
    return () => speechSynthesis.removeEventListener('voiceschanged', handleVoices);
  }, []);

  const getVoice = useCallback(() => {
    const voices = speechSynthesis.getVoices();
    
    // Debug: log available voices to help diagnose
    console.log('[TTS] Available voices:', voices.map(v => `${v.name} (${v.lang})`));
    console.log('[TTS] Requested voice type:', voiceTypeRef.current);
    
    // Strict Mandarin filter: only zh-CN variants, exclude ALL Cantonese/TW/HK
    const isMandarinVoice = (v: SpeechSynthesisVoice) => {
      const langName = v.lang + ' ' + v.name;
      // Exclude Cantonese, HK, TW explicitly
      if (/yue|cantonese|粤|HK|hk|zh-HK|zh_HK|TW|tw|zh-TW|zh_TW|Hongkong|Hong Kong/i.test(langName)) return false;
      // Accept only zh-CN or cmn-Hans-CN
      return v.lang === 'zh-CN' || v.lang === 'zh_CN' || v.lang === 'cmn-Hans-CN';
    };
    
    const pool = voices.filter(isMandarinVoice);
    // Broader fallback if no zh-CN found
    const fallback = pool.length > 0 ? pool : voices.filter(v => 
      v.lang.startsWith('zh') && !/yue|HK|hk|TW|tw|cantonese|粤|Hongkong/i.test(v.lang + v.name)
    );
    const finalPool = fallback.length > 0 ? fallback : voices;
    
    console.log('[TTS] Mandarin pool:', finalPool.map(v => `${v.name} (${v.lang})`));
    
    if (voiceTypeRef.current === 'female') {
      // Prioritize known female voice names
      const female = finalPool.find(v => /Ting-Ting|Xiaoxiao|Hanhan|Lili|Meijia|女|female/i.test(v.name) && !/male(?!.*fe)/i.test(v.name));
      const picked = female || finalPool[0] || voices[0];
      console.log('[TTS] Picked female voice:', picked?.name, picked?.lang);
      return picked;
    }
    if (voiceTypeRef.current === 'male') {
      // Prioritize known male voice names - try multiple patterns
      const male = finalPool.find(v => /Yunxi|Yunyang|Kangkang|男/i.test(v.name))
        || finalPool.find(v => /male/i.test(v.name) && !/female/i.test(v.name));
      // If no explicit male voice found, pick a DIFFERENT voice than the first one (which is usually female)
      const picked = male || (finalPool.length > 1 ? finalPool[finalPool.length - 1] : finalPool[0]) || voices[0];
      console.log('[TTS] Picked male voice:', picked?.name, picked?.lang);
      return picked;
    }
    return finalPool[0] || voices[0];
  }, []);

  const speakParagraph = useCallback((index: number) => {
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
      speakParagraph(index + 1);
      return;
    }

    const utt = new SpeechSynthesisUtterance(text);
    // Very conservative speed mapping for Chinese TTS clarity:
    // User 0.8x → actual 0.85, 1.0x → actual 1.0, 1.2x → actual 1.1, 1.5x → actual 1.2, 2.0x → actual 1.35
    // Chinese characters need more time per syllable than English
    const userRate = rateRef.current;
    const effectiveRate = Math.max(0.8, Math.min(1.35, 0.65 + userRate * 0.35));
    utt.rate = effectiveRate;
    // Keep pitch at 1.0 for natural sound, only tiny bump at high speed
    utt.pitch = effectiveRate > 1.2 ? 1.02 : 1.0;
    utt.lang = 'zh-CN';
    const voice = getVoice();
    if (voice) utt.voice = voice;

    utt.onstart = () => {
      setCurrentParagraph(index);
      currentIndexRef.current = index;
    };
    utt.onend = () => {
      speakParagraph(index + 1);
    };
    utt.onerror = (e) => {
      if (e.error !== 'interrupted') {
        setIsPlaying(false);
      }
    };

    utteranceRef.current = utt;
    speechSynthesis.speak(utt);
  }, [getVoice]);

  // Include chapter titles in the paragraphs for TTS
  const parseTextForTTS = useCallback((text: string): string[] => {
    return text.split('\n').filter(p => p.trim()).map(p => {
      // Convert markdown headers to plain text for reading
      if (p.startsWith('# ')) return p.slice(2).trim();
      if (p.startsWith('## ')) return p.slice(3).trim();
      return p;
    });
  }, []);

  const play = useCallback((text: string, startIndex?: number) => {
    speechSynthesis.cancel();
    isPausedRef.current = false;
    paragraphsRef.current = parseTextForTTS(text);
    const idx = startIndex ?? (selectedParagraph >= 0 ? selectedParagraph : 0);
    setIsPlaying(true);
    speakParagraph(idx);
  }, [speakParagraph, selectedParagraph, parseTextForTTS]);

  const pause = useCallback(() => {
    if (isPlaying) {
      speechSynthesis.cancel();
      isPausedRef.current = true;
      setIsPlaying(false);
    }
  }, [isPlaying]);

  const resume = useCallback((text: string) => {
    if (isPausedRef.current) {
      isPausedRef.current = false;
      paragraphsRef.current = parseTextForTTS(text);
      setIsPlaying(true);
      speakParagraph(currentIndexRef.current);
    }
  }, [speakParagraph, parseTextForTTS]);

  const stop = useCallback(() => {
    speechSynthesis.cancel();
    isPausedRef.current = false;
    setIsPlaying(false);
    setCurrentParagraph(-1);
    setSelectedParagraph(-1);
    currentIndexRef.current = 0;
  }, []);

  const selectParagraph = useCallback((index: number) => {
    setSelectedParagraph(index);
    if (isPlaying) {
      speechSynthesis.cancel();
      isPausedRef.current = false;
      speakParagraph(index);
    }
  }, [isPlaying, speakParagraph]);

  const changeRate = useCallback((newRate: number) => {
    setRate(newRate);
    rateRef.current = newRate;
    if (isPlaying) {
      speechSynthesis.cancel();
      speakParagraph(currentIndexRef.current);
    }
  }, [isPlaying, speakParagraph]);

  const changeVoice = useCallback((v: TTSVoiceType) => {
    setVoiceType(v);
    voiceTypeRef.current = v;
    if (isPlaying) {
      speechSynthesis.cancel();
      speakParagraph(currentIndexRef.current);
    }
  }, [isPlaying, speakParagraph]);

  useEffect(() => {
    return () => { speechSynthesis.cancel(); };
  }, []);

  return {
    isPlaying,
    isPaused: isPausedRef.current,
    currentParagraph,
    selectedParagraph,
    rate,
    voiceType,
    play,
    pause,
    resume,
    stop,
    selectParagraph,
    changeRate,
    changeVoice,
  };
}
