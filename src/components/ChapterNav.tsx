import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Chapter } from '@/types/novel';
import { ChevronLeft, ChevronRight, List } from 'lucide-react';

interface ChapterNavProps {
  chapters: Chapter[];
  currentChapter: number;
  onSelectChapter: (id: number) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function ChapterNav({ chapters, currentChapter, onSelectChapter, isOpen, onToggle }: ChapterNavProps) {
  if (chapters.length === 0) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-30 bg-card/80 backdrop-blur-sm border border-border rounded-r-none lg:hidden"
        title="章节目录"
      >
        {isOpen ? <ChevronRight className="h-4 w-4" /> : <List className="h-4 w-4" />}
      </Button>

      <div className={`border-l border-border bg-card/50 backdrop-blur-sm transition-all duration-300 flex flex-col ${
        isOpen ? 'w-[70vw] sm:w-56 min-w-0 sm:min-w-[224px]' : 'w-0 min-w-0 overflow-hidden'
      } fixed inset-y-12 right-0 z-30 lg:relative lg:inset-auto`}>
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h3 className="font-heading text-sm font-bold flex items-center gap-1">
            <List className="h-4 w-4 text-primary" /> 章节目录
          </h3>
          <Button variant="ghost" size="icon" onClick={onToggle}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {chapters.map(ch => (
              <button
                key={ch.id}
                onClick={() => onSelectChapter(ch.id)}
                className={`w-full text-left text-xs p-2 rounded-md transition-colors ${
                  currentChapter === ch.id
                    ? 'bg-primary/20 text-primary font-medium'
                    : 'hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center gap-1">
                  {ch.isGenerating && <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />}
                  <span className="truncate">{ch.title}</span>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
