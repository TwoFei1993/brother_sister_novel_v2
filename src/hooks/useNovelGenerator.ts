import { useState, useCallback, useRef } from 'react';
import { NovelSettings, Chapter, WorldBuilding, ChapterVersion } from '@/types/novel';
import { systemPrompts } from '@/data/genres';
import { TypewriterPacer } from '@/utils/typewriter';
import { buildChapterPrompt, buildWorldBuildingPrompt } from '@/lib/novelPrompts';

const getApiKey = () => localStorage.getItem('llm_api_key') || localStorage.getItem('openai_api_key') || '';
const getModel = () => localStorage.getItem('llm_model') || localStorage.getItem('openai_model') || 'gpt-4o';
const getBaseUrl = () => (localStorage.getItem('llm_base_url') || 'https://api.openai.com/v1').replace(/\/+$/, '');

export function useNovelGenerator() {
  const [worldBuilding, setWorldBuilding] = useState<WorldBuilding>({ content: '', isGenerating: false });
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const streamFromOpenAI = useCallback(async (
    systemPrompt: string,
    userPrompt: string,
    onChunk: (text: string) => void,
    signal: AbortSignal
  ) => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('请先设置 API Key');

    const res = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getModel(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: true,
        temperature: 0.85,
        max_tokens: 12000,
      }),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API Error: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No reader');
    const decoder = new TextDecoder();
    let buffer = '';

    // 打字机匀速：SSE 文字先进缓冲区，再按固定节奏逐字显示
    const pacer = new TypewriterPacer(onChunk);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        let finished = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') { finished = true; break; }
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) pacer.push(content);
          } catch {}
        }
        if (finished) break;
      }
      // 等缓冲区逐字吐完再结束，避免最后一屏文字突然弹出；
      // 停止信号可打断收尾打字（大段缓冲要打好几秒，不能让停止键在这段窗口失效）
      const abortErr = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
      await Promise.race([
        pacer.drained(),
        new Promise<never>((_, reject) => {
          if (signal.aborted) {
            reject(abortErr());
            return;
          }
          signal.addEventListener('abort', () => reject(abortErr()), { once: true });
        }),
      ]);
    } catch (err) {
      // 停止生成 / 出错时把已收到但未显示的内容一次性补上，不丢字
      pacer.flushSync();
      throw err;
    } finally {
      pacer.stop();
    }
  }, []);

  const generateWorldBuilding = useCallback(async (settings: NovelSettings) => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('请先在右上角设置 API Key');

    abortRef.current = new AbortController();
    setIsGenerating(true);
    setWorldBuilding({ content: '', isGenerating: true });

    let accumulated = '';
    try {
      await streamFromOpenAI(
        systemPrompts[settings.genre],
        buildWorldBuildingPrompt(settings),
        (chunk) => {
          accumulated += chunk;
          setWorldBuilding({ content: accumulated, isGenerating: true });
        },
        abortRef.current.signal
      );
      setWorldBuilding({ content: accumulated, isGenerating: false });
      setIsGenerating(false);
      return accumulated;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // 停止时 pacer.flushSync 会补发缓冲内容，onChunk 把 isGenerating 置回 true——此处必须最后复位
        setWorldBuilding({ content: accumulated, isGenerating: false });
        setIsGenerating(false);
        return accumulated;
      }
      setWorldBuilding(prev => ({ ...prev, isGenerating: false }));
      setIsGenerating(false);
      throw err;
    }
  }, [streamFromOpenAI]);

  const generateChapter = useCallback(async (
    settings: NovelSettings,
    worldBuildingContent: string,
    existingChapters: Chapter[],
    chapterNum: number,
    isRewrite = false
  ) => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('请先在右上角设置 API Key');

    abortRef.current = new AbortController();
    setIsGenerating(true);

    // For rewrite, preserve existing versions
    const existingChapter = existingChapters.find(c => c.id === chapterNum) || 
                           chapters.find(c => c.id === chapterNum);
    const existingVersions = existingChapter?.versions || [];
    
    // If rewriting, save current content as a version if not already saved
    if (isRewrite && existingChapter && existingChapter.content) {
      const alreadySaved = existingVersions.some(v => v.content === existingChapter.content);
      if (!alreadySaved) {
        existingVersions.push({
          content: existingChapter.content,
          title: existingChapter.title,
          createdAt: Date.now(),
          label: existingVersions.length === 0 ? '原版' : `改写v${existingVersions.length}`,
        });
      }
    }

    const newChapter: Chapter = {
      id: chapterNum,
      title: `第${chapterNum}章`,
      content: '',
      isGenerating: true,
      versions: existingVersions,
      currentVersionIndex: undefined, // Will be set after generation
    };
    setChapters(prev => [...prev.filter(c => c.id !== chapterNum), newChapter].sort((a, b) => a.id - b.id));

    let accumulated = '';
    // 标题找到并完整（行已换行）后冻结，不再每 tick 重扫；找齐前扫前 4000 字
    // （200 字上限会漏「>200 字闲聊前导后才出标题」的泄露形态；4000 有界且覆盖实际前导）
    let title: string | null = null;
    try {
      await streamFromOpenAI(
        systemPrompts[settings.genre],
        buildChapterPrompt(settings, worldBuildingContent, existingChapters.filter(c => c.id < chapterNum), chapterNum),
        (chunk) => {
          accumulated += chunk;
          let displayTitle = `第${chapterNum}章`;
          if (title === null) {
            const probe = accumulated.slice(0, 4000);
            const titleMatch = probe.match(/^#\s*第\d+章\s*(.+)/m);
            if (titleMatch) {
              const lineEnd = accumulated.indexOf('\n', titleMatch.index);
              if (lineEnd !== -1) {
                title = `第${chapterNum}章 ${titleMatch[1].trim()}`; // 标题行已完整，冻结
              } else {
                displayTitle = `第${chapterNum}章 ${titleMatch[1]}`; // 行还在流式增长，先显示已到部分
              }
            }
          }
          if (title !== null) displayTitle = title;

          setChapters(prev =>
            prev.map(c => c.id === chapterNum ? { ...c, title: displayTitle, content: accumulated, isGenerating: true } : c)
          );
        },
        abortRef.current.signal
      );

      // Save the new version
      let finalTitle = `第${chapterNum}章`;
      const titleMatch = accumulated.match(/^#\s*第\d+章\s*(.+)/m);
      if (titleMatch) finalTitle = `第${chapterNum}章 ${titleMatch[1].trim()}`;

      const newVersion: ChapterVersion = {
        content: accumulated,
        title: finalTitle,
        createdAt: Date.now(),
        label: isRewrite ? `改写v${existingVersions.length}` : (existingVersions.length === 0 ? '原版' : `v${existingVersions.length}`),
      };
      const allVersions = [...existingVersions, newVersion];

      setChapters(prev =>
        prev.map(c => c.id === chapterNum ? {
          ...c,
          isGenerating: false,
          versions: allVersions,
          currentVersionIndex: allVersions.length - 1,
        } : c)
      );
      setIsGenerating(false);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // 停止时 pacer.flushSync 会补发缓冲内容，onChunk 把 isGenerating 置回 true——此处必须最后复位
        setChapters(prev =>
          prev.map(c => c.id === chapterNum ? { ...c, isGenerating: false } : c)
        );
        setIsGenerating(false);
        return;
      }
      setChapters(prev =>
        prev.map(c => c.id === chapterNum ? { ...c, isGenerating: false } : c)
      );
      setIsGenerating(false);
      throw err;
    }
  }, [streamFromOpenAI, chapters]);

  const switchChapterVersion = useCallback((chapterId: number, versionIndex: number) => {
    setChapters(prev => prev.map(c => {
      if (c.id !== chapterId || !c.versions?.[versionIndex]) return c;
      const v = c.versions[versionIndex];
      return { ...c, content: v.content, title: v.title, currentVersionIndex: versionIndex };
    }));
  }, []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
    setWorldBuilding(prev => ({ ...prev, isGenerating: false }));
    setChapters(prev => prev.map(c => ({ ...c, isGenerating: false })));
  }, []);

  const resetAll = useCallback(() => {
    stopGeneration();
    setWorldBuilding({ content: '', isGenerating: false });
    setChapters([]);
  }, [stopGeneration]);

  return {
    worldBuilding, chapters, isGenerating,
    generateWorldBuilding, generateChapter,
    stopGeneration, resetAll,
    setChapters, setWorldBuilding,
    switchChapterVersion,
  };
}
