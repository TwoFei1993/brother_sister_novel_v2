import React, { useState } from 'react';
import { Settings, BookOpen, Square, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiSettingsDialog } from '@/components/ApiSettingsDialog';
import { NovelProject } from '@/types/novel';

interface TopNavProps {
  onLoadProject: (project: NovelProject) => void;
  isGenerating: boolean;
  onStop: () => void;
  onGoToBookshelf?: () => void;
  showBackToBookshelf?: boolean;
}

export function TopNav({ onLoadProject, isGenerating, onStop, onGoToBookshelf, showBackToBookshelf }: TopNavProps) {
  const [apiOpen, setApiOpen] = useState(false);

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-border bg-card/80 backdrop-blur-sm shrink-0 z-50">
      <div className="flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-heading font-bold theme-glow-text">异界兄妹</h1>
      </div>
      <div className="flex items-center gap-1">
        {isGenerating && (
          <Button variant="destructive" size="sm" onClick={onStop} className="mr-2 gap-1">
            <Square className="h-3 w-3" /> 停止
          </Button>
        )}
        {showBackToBookshelf && (
          <Button variant="ghost" size="sm" onClick={onGoToBookshelf} className="gap-1 text-xs">
            <Library className="h-4 w-4" /> 书架
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => setApiOpen(true)} title="API 设置">
          <Settings className="h-4 w-4" />
        </Button>
      </div>
      <ApiSettingsDialog open={apiOpen} onOpenChange={setApiOpen} />
    </header>
  );
}
