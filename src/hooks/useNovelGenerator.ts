import { useState, useCallback, useRef } from 'react';
import { NovelSettings, Chapter, WorldBuilding, ChapterVersion } from '@/types/novel';
import { systemPrompts, fixedPromptSuffix, writingStylePrompts } from '@/data/genres';

function getWritingStyleBlock(settings: NovelSettings): string {
  if (settings.writingStyle === 'custom' && settings.customWritingStyle) {
    return `\n【文风要求：自定义】\n${settings.customWritingStyle}\n`;
  }
  return writingStylePrompts[settings.writingStyle] || '';
}

function getEffectiveGenre(settings: NovelSettings): string {
  if (settings.genre === 'custom') return settings.customGenre || '自定义';
  const genreLabels: Record<string, string> = {
    chuanyue: '穿越重生', scifi: '星际科幻', moshi: '末世求生',
    wuxian: '无限流', xuanhuan: '玄幻修仙', hunhe: '混合类型',
  };
  return genreLabels[settings.genre] || settings.genre;
}

function getEffectiveSubGenre(settings: NovelSettings): string {
  if (settings.genre === 'custom' || settings.subGenre === '__custom') return settings.customSubGenre || '未指定';
  return settings.subGenre;
}

function getEffectivePersonalities(selected: string[], custom: string): string {
  const all = [...selected];
  if (custom.trim()) all.push(...custom.split(/[,，、]/).map(s => s.trim()).filter(Boolean));
  return all.join('、') || '未设定';
}

const getApiKey = () => localStorage.getItem('llm_api_key') || localStorage.getItem('openai_api_key') || '';
const getModel = () => localStorage.getItem('llm_model') || localStorage.getItem('openai_model') || 'gpt-4o';
const getBaseUrl = () => (localStorage.getItem('llm_base_url') || 'https://api.openai.com/v1').replace(/\/+$/, '');

function buildCharacterConsistencyBlock(settings: NovelSettings, worldBuilding?: string): string {
  // Extract character names from worldBuilding if available
  let characterRef = '';
  if (worldBuilding) {
    // Try to extract character profile sections
    const brotherMatch = worldBuilding.match(/##\s*哥哥人物档案[\s\S]*?(?=##|$)/);
    const sisterMatch = worldBuilding.match(/##\s*妹妹人物档案[\s\S]*?(?=##|$)/);
    if (brotherMatch) characterRef += `\n【哥哥档案摘要】\n${brotherMatch[0].slice(0, 500)}`;
    if (sisterMatch) characterRef += `\n【妹妹档案摘要】\n${sisterMatch[0].slice(0, 500)}`;
  }

  const brotherP = getEffectivePersonalities(settings.brotherPersonalities as string[], settings.customBrotherPersonality);
  const sisterP = getEffectivePersonalities(settings.sisterPersonalities as string[], settings.customSisterPersonality);
  const relation = settings.customRelationType || settings.relationType;

  return `
【人物一致性强制要求 - 每章必须严格遵守】
1. 哥哥核心设定：${settings.brotherAge}岁，性格特征为「${brotherP}」，金手指/能力为「${settings.brotherAbility || '待定'}」
   - 他的言行举止、思维方式必须始终体现上述性格特征
   - 他的能力使用必须与之前章节保持一致，不能突然出现未铺垫的新能力
   - 他的语言风格、口头禅、行为习惯必须前后统一

2. 妹妹核心设定：${settings.sisterAge}岁，性格特征为「${sisterP}」，金手指/能力为「${settings.sisterAbility || '待定'}」
   - 她的言行举止、思维方式必须始终体现上述性格特征
   - 她的能力使用必须与之前章节保持一致
   - 她的语言风格、口头禅、行为习惯必须前后统一

3. 兄妹关系类型：「${relation}」
   - 两人的互动模式必须始终体现这一关系特征
   - 关系的发展要有渐进性，不能突变

4. 禁止以下一致性错误：
   - 性格突变（如冷酷角色突然变得话多热情）
   - 能力设定矛盾（如之前不会的技能突然精通）
   - 外貌描述不一致
   - 称呼方式前后不同
   - 已知信息遗忘（如已经知道的秘密表现得不知道）
${characterRef}`;
}

function buildWorldBuildingPrompt(settings: NovelSettings): string {
  const genre = getEffectiveGenre(settings);
  const subGenre = getEffectiveSubGenre(settings);
  const brotherP = getEffectivePersonalities(settings.brotherPersonalities as string[], settings.customBrotherPersonality);
  const sisterP = getEffectivePersonalities(settings.sisterPersonalities as string[], settings.customSisterPersonality);
  const relation = settings.customRelationType || settings.relationType;
  const tone = settings.customStoryTone || settings.storyTone;
  const styleBlock = getWritingStyleBlock(settings);

  return `请根据以下设定，生成一份完整的世界观文档。

题材：${genre} - ${subGenre}
故事背景补充：${settings.backgroundNote || '无'}
哥哥：${settings.brotherAge}岁，性格：${brotherP}，能力：${settings.brotherAbility || '未设定'}
妹妹：${settings.sisterAge}岁，性格：${sisterP}，能力：${settings.sisterAbility || '未设定'}
兄妹关系：${relation}
能力/修炼体系：${settings.powerSystem || '由你设计'}
主要势力：${settings.factions || '由你设计'}
核心矛盾：${settings.coreConflict || '由你设计'}
故事基调：${tone}
额外要求：${settings.extraRequirements || '无'}
${styleBlock}

请生成以下内容（使用markdown格式）：
## 世界背景介绍（500字）
## 能力体系详细说明（300字）
## 哥哥人物档案（200字，包含姓名/外貌特征/性格细节/背景/隐藏秘密/语言风格/标志性动作或习惯）
## 妹妹人物档案（200字，包含姓名/外貌特征/性格细节/背景/隐藏秘密/语言风格/标志性动作或习惯）
## 主要势力简介
## 十个核心情节点大纲
（有起承转合，第10点是震撼结局）

【特别注意】人物档案中请务必明确：
- 每个角色的外貌特征（发色、瞳色、体型、标志性穿着）
- 说话方式和口头禅
- 标志性小动作或习惯
- 这些细节将在后续所有章节中保持一致

${fixedPromptSuffix}`;
}

function buildChapterPrompt(
  settings: NovelSettings,
  worldBuilding: string,
  chapters: Chapter[],
  chapterNum: number
): string {
  const lengthMap = { trial: 3000, short: 8000, medium: 15000, long: 5000 };
  const targetWords = lengthMap[settings.lengthType];
  
  const previousSummary = chapters.length > 0
    ? `\n\n前文摘要：\n${chapters.map(c => `第${c.id}章「${c.title}」：${c.content.slice(0, 300)}...`).join('\n')}`
    : '';

  const characterBlock = buildCharacterConsistencyBlock(settings, worldBuilding);
  const styleBlock = getWritingStyleBlock(settings);

  return `以下是已生成的世界观和大纲：
${worldBuilding}
${previousSummary}

${characterBlock}
${styleBlock}

请撰写第${chapterNum}章，字数不少于${targetWords}字。
格式要求：
- 第一行写章节标题，格式为：# 第${chapterNum}章 章节标题
- 然后直接开始正文
- 注意与前文保持设定一致性
- 人物的外貌、性格、能力、说话方式必须与人物档案和前文完全一致

${fixedPromptSuffix}`;
}

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
        max_tokens: 8000,
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) onChunk(content);
        } catch {}
      }
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
    try {
      await streamFromOpenAI(
        systemPrompts[settings.genre],
        buildChapterPrompt(settings, worldBuildingContent, existingChapters.filter(c => c.id < chapterNum), chapterNum),
        (chunk) => {
          accumulated += chunk;
          let title = `第${chapterNum}章`;
          const titleMatch = accumulated.match(/^#\s*第\d+章\s*(.+)/m);
          if (titleMatch) title = `第${chapterNum}章 ${titleMatch[1].trim()}`;

          setChapters(prev =>
            prev.map(c => c.id === chapterNum ? { ...c, title, content: accumulated, isGenerating: true } : c)
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
      if (err.name !== 'AbortError') {
        setChapters(prev =>
          prev.map(c => c.id === chapterNum ? { ...c, isGenerating: false } : c)
        );
        setIsGenerating(false);
        throw err;
      }
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
