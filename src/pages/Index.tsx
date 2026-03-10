import React, { useState, useCallback, useEffect, useRef } from 'react';
import { TopNav } from '@/components/TopNav';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ReadingArea } from '@/components/ReadingArea';
import { WorldBuildingSidebar } from '@/components/WorldBuildingSidebar';
import { ChapterNav } from '@/components/ChapterNav';
import { TTSBar } from '@/components/TTSBar';
import { Bookshelf } from '@/components/Bookshelf';
import { HolidayBanner } from '@/components/HolidayBanner';
import { OutlineConfirmDialog } from '@/components/OutlineConfirmDialog';
import { useNovelGenerator } from '@/hooks/useNovelGenerator';
import { useEasyTTS } from '@/hooks/useEasyTTS';
import { NovelSettings, NovelProject, defaultSettings, GenreType } from '@/types/novel';
import { genres, brotherPersonalities, sisterPersonalities, relationTypes, storyTones, lengthOptions, writingStyles } from '@/data/genres';
import { toast } from 'sonner';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';

const themeMap: Record<GenreType, string> = {
  chuanyue: 'chuanyue', scifi: 'scifi', moshi: 'moshi',
  wuxian: 'wuxian', xuanhuan: 'xuanhuan', hunhe: 'hunhe', custom: 'hunhe',
};

function randomize(): NovelSettings {
  // Exclude 'custom' genre from random
  const nonCustomGenres = genres.filter(g => g.id !== 'custom');
  const genre = nonCustomGenres[Math.floor(Math.random() * nonCustomGenres.length)];
  const subGenre = genre.subGenres.length > 0
    ? genre.subGenres[Math.floor(Math.random() * genre.subGenres.length)].id
    : '';
  const pickN = <T,>(arr: readonly T[], n: number): T[] => {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
  };
  const nonCustomStyles = writingStyles.filter(s => s.id !== 'custom');
  return {
    ...defaultSettings,
    genre: genre.id,
    subGenre,
    brotherAge: 18 + Math.floor(Math.random() * 18),
    brotherPersonalities: pickN(brotherPersonalities, 1 + Math.floor(Math.random() * 3)) as any,
    sisterAge: 16 + Math.floor(Math.random() * 15),
    sisterPersonalities: pickN(sisterPersonalities, 1 + Math.floor(Math.random() * 3)) as any,
    relationType: relationTypes[Math.floor(Math.random() * relationTypes.length)] as any,
    storyTone: storyTones[Math.floor(Math.random() * storyTones.length)] as any,
    writingStyle: nonCustomStyles[Math.floor(Math.random() * nonCustomStyles.length)].id,
    lengthType: lengthOptions[Math.floor(Math.random() * lengthOptions.length)].id,
  };
}

function saveToHistory(settings: NovelSettings, worldBuilding: string, chapters: any[], existingId?: string, bookTitle?: string) {
  const projects: NovelProject[] = JSON.parse(localStorage.getItem('novel_history') || '[]');
  const now = Date.now();

  if (existingId) {
    const idx = projects.findIndex(p => p.id === existingId);
    if (idx >= 0) {
      projects[idx] = {
        ...projects[idx],
        settings,
        worldBuilding: { content: worldBuilding },
        chapters: chapters.map(c => ({ ...c, isGenerating: false })),
        updatedAt: now,
        title: bookTitle || chapters[0]?.title || projects[idx].title,
      };
      localStorage.setItem('novel_history', JSON.stringify(projects));
      return existingId;
    }
  }

  const id = now.toString();
  const project: NovelProject = {
    id,
    settings,
    worldBuilding: { content: worldBuilding },
    chapters: chapters.map(c => ({ ...c, isGenerating: false })),
    createdAt: now,
    updatedAt: now,
    title: bookTitle || chapters[0]?.title || '未命名',
  };
  const updated = [project, ...projects].slice(0, 20);
  localStorage.setItem('novel_history', JSON.stringify(updated));
  return id;
}

type ViewMode = 'bookshelf' | 'editor';

const Index = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('bookshelf');
  const [settings, setSettings] = useState<NovelSettings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [worldOpen, setWorldOpen] = useState(true);
  const [chapterNavOpen, setChapterNavOpen] = useState(true);
  const [currentChapter, setCurrentChapter] = useState(1);
  const [readingMode, setReadingMode] = useState('day');
  const [fontSize, setFontSize] = useState(16);
  const [lineHeight, setLineHeight] = useState('1.8');
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState('');
  const [isCompletingNovel, setIsCompletingNovel] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number } | null>(null);

  // Outline confirmation flow
  const [outlineConfirmOpen, setOutlineConfirmOpen] = useState(false);
  const [pendingOutline, setPendingOutline] = useState('');
  // For mid-writing outline editing
  const [outlineEditOpen, setOutlineEditOpen] = useState(false);

  const {
    worldBuilding, chapters, isGenerating,
    generateWorldBuilding, generateChapter,
    stopGeneration, resetAll, setChapters, setWorldBuilding,
    switchChapterVersion,
  } = useNovelGenerator();

  // TTS with auto-next-chapter
  const handleTTSChapterEnd = useCallback(() => {
    const next = currentChapter + 1;
    const ch = chapters.find(c => c.id === next);
    if (ch) {
      setCurrentChapter(next);
      // Will be played by the effect below
      setTimeout(() => {
        const chapter = chapters.find(c => c.id === next);
        if (chapter) tts.play(chapter.content, 0);
      }, 100);
    }
  }, [currentChapter, chapters]);

  const tts = useEasyTTS(handleTTSChapterEnd);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMap[settings.genre]);
  }, [settings.genre]);

  // Auto-save whenever chapters change (after generation completes)
  const prevChaptersRef = useRef(chapters);
  useEffect(() => {
    if (chapters.length > 0 && !isGenerating && currentProjectId) {
      const hasChange = chapters !== prevChaptersRef.current;
      if (hasChange) {
        saveToHistory(settings, worldBuilding.content, chapters, currentProjectId, bookTitle);
      }
    }
    prevChaptersRef.current = chapters;
  }, [chapters, isGenerating, currentProjectId, settings, worldBuilding.content, bookTitle]);

  // Phase 1: Generate outline only
  const handleGenerate = useCallback(async () => {
    const apiKey = localStorage.getItem('llm_api_key') || localStorage.getItem('openai_api_key');
    if (!apiKey) { toast.error('请先在右上角设置 API Key'); return; }

    try {
      resetAll();
      setCurrentProjectId(null);
      setBookTitle('');
      const wb = await generateWorldBuilding(settings);
      if (!wb) return;
      setPendingOutline(wb);
      setOutlineConfirmOpen(true);
    } catch (err: any) {
      toast.error(err.message || '生成失败');
    }
  }, [settings, generateWorldBuilding, resetAll]);

  // Phase 2: User confirmed outline, start writing
  const handleOutlineConfirmed = useCallback(async (title: string) => {
    setOutlineConfirmOpen(false);
    setOutlineEditOpen(false);
    setBookTitle(title);
    setViewMode('editor');
    setSettingsOpen(false);

    // Ensure worldBuilding state matches the confirmed/edited outline
    setWorldBuilding({ content: pendingOutline, isGenerating: false });

    try {
      await generateChapter(settings, pendingOutline, [], 1);
      setCurrentChapter(1);
      const id = saveToHistory(settings, pendingOutline, [], undefined, title);
      setCurrentProjectId(id);
    } catch (err: any) {
      toast.error(err.message || '生成失败');
    }
  }, [settings, pendingOutline, generateChapter, setWorldBuilding]);

  const handleRegenerateOutline = useCallback(async () => {
    try {
      const wb = await generateWorldBuilding(settings);
      if (wb) setPendingOutline(wb);
    } catch (err: any) {
      toast.error(err.message || '重新生成大纲失败');
    }
  }, [settings, generateWorldBuilding]);

  const handleEditOutline = useCallback((content: string) => {
    setPendingOutline(content);
    setWorldBuilding({ content, isGenerating: false });
  }, [setWorldBuilding]);

  // Open outline editing dialog mid-writing
  const handleOpenOutlineEdit = useCallback(() => {
    setPendingOutline(worldBuilding.content);
    setOutlineEditOpen(true);
  }, [worldBuilding.content]);

  const handleSaveOutlineEdit = useCallback((content: string) => {
    setPendingOutline(content);
    setWorldBuilding({ content, isGenerating: false });
    setOutlineEditOpen(false);
    toast.success('大纲已更新，后续章节将基于新大纲生成');
  }, [setWorldBuilding]);

  const handleContinue = useCallback(async () => {
    const nextChapter = chapters.length + 1;
    try {
      await generateChapter(settings, worldBuilding.content, chapters, nextChapter);
      setCurrentChapter(nextChapter);
      if (currentProjectId) {
        saveToHistory(settings, worldBuilding.content, chapters, currentProjectId, bookTitle);
      }
    } catch (err: any) {
      toast.error(err.message || '续写失败');
    }
  }, [chapters, settings, worldBuilding.content, generateChapter, currentProjectId, bookTitle]);

  // Complete entire novel
  const handleCompleteNovel = useCallback(async () => {
    const totalChapters = settings.desiredChapterCount || 10;
    const startFrom = chapters.length + 1;
    if (startFrom > totalChapters) {
      toast.info('小说已完成！');
      return;
    }

    setIsCompletingNovel(true);
    setGenerationProgress({ current: startFrom - 1, total: totalChapters });

    let currentChapters = [...chapters];
    try {
      for (let i = startFrom; i <= totalChapters; i++) {
        setGenerationProgress({ current: i, total: totalChapters });
        await generateChapter(settings, worldBuilding.content, currentChapters, i);
        // Get updated chapters for next iteration
        // We need to read from the hook's state, but since it's async we pass currentChapters
        currentChapters = [...currentChapters]; // Will be updated by the hook
        setCurrentChapter(i);
        if (currentProjectId) {
          saveToHistory(settings, worldBuilding.content, currentChapters, currentProjectId, bookTitle);
        }
      }
      toast.success('小说创作完成！');
    } catch (err: any) {
      if (err.name !== 'AbortError') toast.error(err.message || '生成失败');
    } finally {
      setIsCompletingNovel(false);
      setGenerationProgress(null);
    }
  }, [chapters, settings, worldBuilding.content, generateChapter, currentProjectId, bookTitle]);

  const handleRewrite = useCallback(async (chapterId: number) => {
    try {
      await generateChapter(settings, worldBuilding.content, chapters, chapterId, true);
      if (currentProjectId) {
        saveToHistory(settings, worldBuilding.content, chapters, currentProjectId, bookTitle);
      }
    } catch (err: any) {
      toast.error(err.message || '重写失败');
    }
  }, [chapters, settings, worldBuilding.content, generateChapter, currentProjectId, bookTitle]);

  const handleLoadProject = useCallback((project: NovelProject, enterEditor = true) => {
    setSettings(project.settings);
    setWorldBuilding(project.worldBuilding);
    setChapters(project.chapters);
    setCurrentProjectId(project.id);
    setBookTitle(project.title || '');
    if (project.chapters.length > 0) {
      setCurrentChapter(project.chapters[0].id);
    }
    if (enterEditor) {
      setViewMode('editor');
      setSettingsOpen(false);
    }
  }, [setWorldBuilding, setChapters]);

  const handleContinueProject = useCallback((project: NovelProject) => {
    handleLoadProject(project, true);
  }, [handleLoadProject]);

  const handleNewProject = useCallback(() => {
    resetAll();
    setSettings(defaultSettings);
    setCurrentProjectId(null);
    setBookTitle('');
    setSettingsOpen(true);
    setViewMode('editor');
  }, [resetAll]);

  // TTS play/pause toggle
  const handleTTSPlayPause = useCallback(() => {
    const chapter = chapters.find(c => c.id === currentChapter);
    if (!chapter) return;

    if (tts.isPlaying) {
      // Pause
      tts.pause();
    } else {
      // Resume or start fresh
      tts.resume(chapter.content);
      // If resume didn't work (wasn't paused), start fresh
      if (!tts.isPlaying) {
        tts.play(chapter.content);
      }
    }
  }, [chapters, currentChapter, tts]);

  const handleTTSStop = useCallback(() => {
    tts.stop();
    // Reset to chapter beginning
  }, [tts]);

  const handleTTSPrevChapter = useCallback(() => {
    if (currentChapter > 1) {
      const prevId = currentChapter - 1;
      setCurrentChapter(prevId);
      tts.stop();
      const ch = chapters.find(c => c.id === prevId);
      if (ch) setTimeout(() => tts.play(ch.content, 0), 100);
    }
  }, [currentChapter, chapters, tts]);

  const handleTTSNextChapter = useCallback(() => {
    const next = currentChapter + 1;
    const ch = chapters.find(c => c.id === next);
    if (ch) {
      setCurrentChapter(next);
      tts.stop();
      setTimeout(() => tts.play(ch.content, 0), 100);
    }
  }, [currentChapter, chapters, tts]);

  // Paragraph click: highlight and set start position
  const handleParagraphClick = useCallback((filteredIndex: number, chapterId: number) => {
    setCurrentChapter(chapterId);
    tts.selectParagraph(filteredIndex);
  }, [tts]);

  const hasContent = worldBuilding.content.length > 0 || chapters.length > 0;

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <HolidayBanner />
      <TopNav
        onLoadProject={handleLoadProject}
        isGenerating={isGenerating}
        onStop={stopGeneration}
        onGoToBookshelf={() => setViewMode('bookshelf')}
        showBackToBookshelf={viewMode === 'editor'}
      />

      {viewMode === 'bookshelf' ? (
        <Bookshelf
          onOpenProject={(p) => handleLoadProject(p, true)}
          onContinueProject={handleContinueProject}
          onNewProject={handleNewProject}
        />
      ) : (
        <>
          <div className="flex-1 flex overflow-hidden relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="fixed top-14 left-2 z-50 lg:hidden bg-card/80 backdrop-blur-sm border border-border"
            >
              <Menu className="h-4 w-4" />
            </Button>

            {settingsOpen && (
              <div
                className="fixed inset-0 bg-background/50 backdrop-blur-sm z-30 lg:hidden"
                onClick={() => setSettingsOpen(false)}
              />
            )}

            <SettingsPanel
              settings={settings}
              onChange={setSettings}
              onGenerate={handleGenerate}
              onRandomize={() => setSettings(randomize())}
              isGenerating={isGenerating}
              isOpen={settingsOpen}
              onClose={() => setSettingsOpen(false)}
            />

            <WorldBuildingSidebar
              worldBuilding={worldBuilding}
              isOpen={worldOpen && hasContent}
              onToggle={() => setWorldOpen(!worldOpen)}
            />

            <ReadingArea
              chapters={chapters}
              currentChapter={currentChapter}
              onSelectChapter={setCurrentChapter}
              onContinue={handleContinue}
              onRewrite={handleRewrite}
              isGenerating={isGenerating}
              genre={settings.genre}
              ttsCurrentParagraph={tts.currentParagraph}
              ttsSelectedParagraph={tts.selectedParagraph}
              onParagraphClick={handleParagraphClick}
              readingMode={readingMode}
              onReadingModeChange={setReadingMode}
              fontSize={fontSize}
              onFontSizeChange={setFontSize}
              lineHeight={lineHeight}
              onLineHeightChange={setLineHeight}
              hasContent={hasContent}
              onSwitchVersion={switchChapterVersion}
              onCompleteNovel={handleCompleteNovel}
              onEditOutline={handleOpenOutlineEdit}
              isCompletingNovel={isCompletingNovel}
              generationProgress={generationProgress}
            />

            <ChapterNav
              chapters={chapters}
              currentChapter={currentChapter}
              onSelectChapter={setCurrentChapter}
              isOpen={chapterNavOpen && chapters.length > 0}
              onToggle={() => setChapterNavOpen(!chapterNavOpen)}
            />
          </div>

          <TTSBar
            isPlaying={tts.isPlaying}
            isLoading={tts.isLoading}
            rate={tts.rate}
            voiceType={tts.voiceType}
            onPlayPause={handleTTSPlayPause}
            onStop={handleTTSStop}
            onRateChange={tts.changeRate}
            onVoiceChange={tts.changeVoice}
            onPrevChapter={handleTTSPrevChapter}
            onNextChapter={handleTTSNextChapter}
            visible={hasContent}
          />
        </>
      )}

      {/* Initial outline confirmation */}
      <OutlineConfirmDialog
        open={outlineConfirmOpen}
        onOpenChange={setOutlineConfirmOpen}
        outlineContent={pendingOutline}
        onConfirm={handleOutlineConfirmed}
        onRegenerate={handleRegenerateOutline}
        onEditOutline={handleEditOutline}
        isRegenerating={isGenerating}
        pastedOutline={settings.pastedOutline}
      />

      {/* Mid-writing outline editing */}
      <OutlineConfirmDialog
        open={outlineEditOpen}
        onOpenChange={setOutlineEditOpen}
        outlineContent={pendingOutline}
        onConfirm={() => {
          handleSaveOutlineEdit(pendingOutline);
        }}
        onRegenerate={handleRegenerateOutline}
        onEditOutline={(content) => {
          setPendingOutline(content);
        }}
        isRegenerating={isGenerating}
        pastedOutline={settings.pastedOutline}
      />
    </div>
  );
};

export default Index;
