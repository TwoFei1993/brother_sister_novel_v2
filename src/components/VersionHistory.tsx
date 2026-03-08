import React from 'react';
import { Chapter, ChapterVersion } from '@/types/novel';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Clock, Check } from 'lucide-react';

interface VersionHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapter: Chapter | null;
  onSelectVersion: (chapterId: number, versionIndex: number) => void;
}

export function VersionHistory({ open, onOpenChange, chapter, onSelectVersion }: VersionHistoryProps) {
  if (!chapter) return null;

  const versions = chapter.versions || [];
  const currentIdx = chapter.currentVersionIndex ?? versions.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{chapter.title} - 版本历史</DialogTitle>
        </DialogHeader>
        {versions.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">暂无历史版本</p>
        ) : (
          <div className="space-y-2">
            {versions.map((v, idx) => (
              <button
                key={idx}
                onClick={() => {
                  onSelectVersion(chapter.id, idx);
                  onOpenChange(false);
                }}
                className={`w-full text-left p-3 rounded-lg transition-colors flex items-start gap-3 ${
                  idx === currentIdx
                    ? 'bg-primary/10 border border-primary/30'
                    : 'bg-secondary/50 hover:bg-secondary'
                }`}
              >
                <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{v.label}</span>
                    {idx === currentIdx && (
                      <span className="flex items-center gap-0.5 text-[10px] text-primary">
                        <Check className="h-3 w-3" /> 当前
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {new Date(v.createdAt).toLocaleString('zh-CN')} · {v.content.length}字
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {v.content.slice(0, 100)}...
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
