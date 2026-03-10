import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NovelProject } from '@/types/novel';
import { Trash2 } from 'lucide-react';

interface HistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoad: (project: NovelProject) => void;
}

export function HistoryDialog({ open, onOpenChange, onLoad }: HistoryDialogProps) {
  const [projects, setProjects] = useState<NovelProject[]>([]);

  useEffect(() => {
    if (open) {
      const saved = JSON.parse(localStorage.getItem('novel_history') || '[]');
      setProjects(saved);
    }
  }, [open]);

  const handleDelete = (id: string) => {
    const updated = projects.filter(p => p.id !== id);
    localStorage.setItem('novel_history', JSON.stringify(updated));
    setProjects(updated);
  };

  const handleLoad = (project: NovelProject) => {
    onLoad(project);
    onOpenChange(false);
  };

  const genreLabels: Record<string, string> = {
    chuanyue: '穿越重生', scifi: '星际科幻', moshi: '末世求生',
    wuxian: '无限流', xuanhuan: '玄幻修仙', hunhe: '混合类型',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">历史记录</DialogTitle>
        </DialogHeader>
        {projects.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">暂无历史记录</p>
        ) : (
          <div className="space-y-2">
            {projects.map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
                <button onClick={() => handleLoad(p)} className="flex-1 text-left">
                  <div className="font-medium text-sm">{p.title || '未命名'}</div>
                  <div className="text-xs text-muted-foreground">
                    {genreLabels[p.settings.genre]} · {p.chapters.length}章 · {new Date(p.createdAt).toLocaleDateString('zh-CN')}
                  </div>
                </button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
