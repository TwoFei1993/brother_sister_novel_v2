import React from 'react';
import ReactMarkdown from 'react-markdown';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { WorldBuilding } from '@/types/novel';
import { ChevronRight, ChevronLeft, Globe } from 'lucide-react';

interface WorldBuildingSidebarProps {
  worldBuilding: WorldBuilding;
  isOpen: boolean;
  onToggle: () => void;
}

export function WorldBuildingSidebar({ worldBuilding, isOpen, onToggle }: WorldBuildingSidebarProps) {
  if (!worldBuilding.content && !worldBuilding.isGenerating) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-30 bg-card/80 backdrop-blur-sm border border-border rounded-l-none lg:hidden"
        title="世界观"
      >
        {isOpen ? <ChevronLeft className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
      </Button>

      <div className={`border-r border-border bg-card/50 backdrop-blur-sm transition-all duration-300 flex flex-col ${
        isOpen ? 'w-[85vw] sm:w-80 min-w-0 sm:min-w-[320px]' : 'w-0 min-w-0 overflow-hidden'
      } fixed inset-y-12 left-0 z-30 lg:relative lg:inset-auto`}>
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h3 className="font-heading text-sm font-bold flex items-center gap-1">
            <Globe className="h-4 w-4 text-primary" /> 世界观 & 大纲
          </h3>
          <Button variant="ghost" size="icon" onClick={onToggle}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 prose prose-sm max-w-none text-foreground prose-headings:text-primary prose-headings:font-heading prose-strong:text-foreground">
            {worldBuilding.isGenerating && (
              <div className="flex items-center gap-2 text-xs text-primary mb-2">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                正在构建世界观...
              </div>
            )}
            <ReactMarkdown>{worldBuilding.content}</ReactMarkdown>
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
