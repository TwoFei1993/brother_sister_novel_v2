import React, { useRef, useState, useMemo, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Chapter } from '@/types/novel';
import { RefreshCw, Copy, Download, Sun, Moon, Eye, Rocket, History, Edit3 } from 'lucide-react';
import { LoadingAnimation } from '@/components/LoadingAnimation';
import { GenreType } from '@/types/novel';
import { VersionHistory } from '@/components/VersionHistory';

interface ReadingAreaProps {
  chapters: Chapter[];
  currentChapter: number;
  onSelectChapter: (id: number) => void;
  onContinue: () => void;
  onContinue3: () => void;
  onContinue10: () => void;
  onRewrite: (id: number) => void;
  isGenerating: boolean;
  genre: GenreType;
  ttsCurrentParagraph: number;
  ttsSelectedParagraph: number;
  onParagraphClick: (filteredIndex: number, chapterId: number) => void;
  readingMode: string;
  onReadingModeChange: (mode: string) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  lineHeight: string;
  onLineHeightChange: (lh: string) => void;
  hasContent: boolean;
  onSwitchVersion: (chapterId: number, versionIndex: number) => void;
  onEditOutline: () => void;
  isCompletingNovel: boolean;
  generationProgress: { current: number; total: number } | null;
}

const readingModes = [
  { id: 'day', label: '白天', icon: Sun },
  { id: 'night', label: '夜间', icon: Moon },
  { id: 'eye', label: '护眼', icon: Eye },
  { id: 'space', label: '深空', icon: Rocket },
];

const fontSizes = [
  { id: 14, label: '小' },
  { id: 16, label: '中' },
  { id: 18, label: '大' },
  { id: 22, label: '超大' },
];

const lineHeights = [
  { id: '1.5', label: '紧凑' },
  { id: '1.8', label: '标准' },
  { id: '2.2', label: '宽松' },
];

export function ReadingArea({
  chapters, currentChapter, onSelectChapter, onContinue, onContinue3, onContinue10, onRewrite,
  isGenerating, genre, ttsCurrentParagraph, ttsSelectedParagraph, onParagraphClick,
  readingMode, onReadingModeChange, fontSize, onFontSizeChange,
  lineHeight, onLineHeightChange, hasContent, onSwitchVersion,
  onEditOutline, isCompletingNovel, generationProgress,
}: ReadingAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionChapter, setVersionChapter] = useState<Chapter | null>(null);

  // Track global paragraph offset for TTS per chapter
  const chapterParagraphs = useMemo(() => {
    return chapters.map(ch => {
      if (!ch.content) return [];
      return ch.content.split('\n').filter(p => p.trim() && !p.startsWith('# '));
    });
  }, [chapters]);

  const handleCopyAll = () => {
    const all = chapters.map(c => c.content).join('\n\n---\n\n');
    navigator.clipboard.writeText(all);
  };

  const handleExportTxt = () => {
    const all = chapters.map(c => c.content).join('\n\n---\n\n');
    const blob = new Blob([all], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '小说导出.txt'; a.click();
    URL.revokeObjectURL(url);
  };

  const readingBg = readingMode === 'night' ? 'hsl(0 0% 6%)' :
    readingMode === 'eye' ? 'hsl(85 30% 88%)' :
    readingMode === 'space' ? 'hsl(230 30% 6%)' : undefined;

  const readingFg = readingMode === 'night' ? 'hsl(0 0% 75%)' :
    readingMode === 'eye' ? 'hsl(85 20% 20%)' :
    readingMode === 'space' ? 'hsl(200 60% 80%)' : undefined;

  const totalChapters = chapters.length;
  const progress = totalChapters > 0 ? ((currentChapter) / totalChapters) * 100 : 0;

  // Auto-scroll to current chapter when it changes
  useEffect(() => {
    const el = document.getElementById(`chapter-${currentChapter}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [currentChapter]);

  if (!hasContent) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-heading font-bold theme-glow-text mb-4">异界兄妹</h2>
          <p className="text-muted-foreground mb-2">AI 长篇小说自动写作平台</p>
          <p className="text-xs text-muted-foreground">在左侧配置设定，点击「开始创作」即可生成</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Progress bar */}
      <div className="h-1 bg-secondary">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      {/* Generation progress indicator */}
      {generationProgress && isGenerating && (
        <div className="px-4 py-1.5 bg-primary/10 border-b border-border flex items-center gap-2 text-xs">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          <span>正在生成第 {generationProgress.current} / {generationProgress.total} 章</span>
          <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 sm:px-4 py-1.5 sm:py-2 border-b border-border flex-wrap gap-1 sm:gap-2">
        <div className="flex items-center gap-0.5 sm:gap-1 flex-wrap">
          {readingModes.map(m => (
            <button
              key={m.id}
              onClick={() => onReadingModeChange(m.id)}
              className={`p-1 sm:p-1.5 rounded text-xs ${readingMode === m.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title={m.label}
            >
              <m.icon className="h-3 w-3" />
            </button>
          ))}
          <span className="text-muted-foreground mx-0.5 sm:mx-1 hidden sm:inline">|</span>
          {fontSizes.map(f => (
            <button
              key={f.id}
              onClick={() => onFontSizeChange(f.id)}
              className={`px-1 sm:px-1.5 py-0.5 rounded text-[10px] sm:text-xs ${fontSize === f.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {f.label}
            </button>
          ))}
          <span className="text-muted-foreground mx-0.5 sm:mx-1 hidden sm:inline">|</span>
          {lineHeights.map(l => (
            <button
              key={l.id}
              onClick={() => onLineHeightChange(l.id)}
              className={`px-1 sm:px-1.5 py-0.5 rounded text-[10px] sm:text-xs hidden sm:inline-block ${lineHeight === l.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1">
          <Button variant="ghost" size="sm" onClick={onEditOutline} className="text-[10px] sm:text-xs gap-1 h-6 sm:h-7 px-1.5 sm:px-2">
            <Edit3 className="h-3 w-3" /> <span className="hidden sm:inline">调整大纲</span><span className="sm:hidden">大纲</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopyAll} className="text-[10px] sm:text-xs gap-1 h-6 sm:h-7 px-1.5 sm:px-2">
            <Copy className="h-3 w-3" /> <span className="hidden sm:inline">复制</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExportTxt} className="text-[10px] sm:text-xs gap-1 h-6 sm:h-7 px-1.5 sm:px-2">
            <Download className="h-3 w-3" /> <span className="hidden sm:inline">TXT</span>
          </Button>
        </div>
      </div>

      {/* Seamless reading area - all chapters in one scroll */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div
          className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-8 pb-20"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: lineHeight,
            backgroundColor: readingBg,
            color: readingFg,
            minHeight: '100%',
          }}
        >
          {chapters.length === 0 ? (
            <LoadingAnimation genre={genre} text="正在构建世界观..." isVisible={true} />
          ) : (
            <>
              {chapters.map((chapter) => {
                const filteredParagraphs = chapter.content
                  ? chapter.content.split('\n').filter(p => p.trim())
                  : [];

                const versionCount = chapter.versions?.length || 0;
                const currentVersionLabel = chapter.versions?.[chapter.currentVersionIndex ?? -1]?.label;

                return (
                  <div key={chapter.id} id={`chapter-${chapter.id}`} className="mb-12">
                    {/* Chapter header */}
                    <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
                      <h2 className="text-xl font-heading font-bold">{chapter.title}</h2>
                      <div className="flex items-center gap-1">
                        {versionCount > 1 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setVersionChapter(chapter); setVersionOpen(true); }}
                            className="text-xs gap-1 h-7"
                          >
                            <History className="h-3 w-3" />
                            {currentVersionLabel || '版本'} ({versionCount})
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onRewrite(chapter.id)}
                          disabled={isGenerating}
                          className="text-xs gap-1 h-7"
                        >
                          <RefreshCw className="h-3 w-3" /> 重写
                        </Button>
                      </div>
                    </div>

                    {chapter.isGenerating && !chapter.content && (
                      <LoadingAnimation
                        genre={genre}
                        text={`正在创作第${chapter.id}章...`}
                        isVisible={true}
                      />
                    )}

                    {/* Chapter content */}
                    <div className="prose prose-sm max-w-none">
                      {filteredParagraphs.map((text, idx) => {
                        const isCurrentTTS = currentChapter === chapter.id && ttsCurrentParagraph === idx;
                        const isSelected = currentChapter === chapter.id && ttsSelectedParagraph === idx;
                        const isTitle = text.startsWith('# ') || text.startsWith('## ');
                        const displayText = isTitle ? text.replace(/^#+\s*/, '') : text;
                        return (
                          <p
                            key={idx}
                            onClick={() => {
                              onSelectChapter(chapter.id);
                              onParagraphClick(idx, chapter.id);
                            }}
                            className={`cursor-pointer hover:bg-primary/5 transition-colors mb-3 rounded px-1 -mx-1 ${
                              isCurrentTTS ? 'tts-highlight' : ''
                            } ${isSelected && !isCurrentTTS ? 'bg-primary/10 ring-1 ring-primary/30' : ''}
                            ${isTitle ? 'text-lg font-bold font-heading' : ''}`}
                          >
                            {displayText}
                          </p>
                        );
                      })}
                    </div>

                    {chapter.isGenerating && chapter.content && (
                      <div className="flex items-center gap-2 text-xs text-primary mt-4">
                        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                        创作中...
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Single bottom action area */}
              {!isGenerating && chapters.length > 0 && (
                <div className="flex justify-center gap-3 mt-4 mb-12 flex-wrap">
                  <Button onClick={onContinue} disabled={isGenerating} className="gap-1 theme-glow font-heading">
                    续写下一章
                  </Button>
                  <Button onClick={onContinue3} disabled={isGenerating || isCompletingNovel} variant="outline" className="gap-1 font-heading">
                    {isCompletingNovel ? '写作中...' : '生成下三章'}
                  </Button>
                  <Button onClick={onContinue10} disabled={isGenerating || isCompletingNovel} variant="outline" className="gap-1 font-heading">
                    生成下十章
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>

      <VersionHistory
        open={versionOpen}
        onOpenChange={setVersionOpen}
        chapter={versionChapter}
        onSelectVersion={onSwitchVersion}
      />
    </div>
  );
}
