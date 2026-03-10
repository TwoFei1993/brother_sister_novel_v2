import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Edit3, Check, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface OutlineConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outlineContent: string;
  onConfirm: (bookTitle: string) => void;
  onRegenerate: () => void;
  onEditOutline: (content: string) => void;
  isRegenerating: boolean;
  pastedOutline?: string;
  aiSuggestedNames?: string[];
}

function generateSuggestedNames(outline: string): string[] {
  const names: string[] = [];
  const brotherMatch = outline.match(/哥哥.*?(?:名|叫|为|：)\s*[「【]?([^\s「」【】,，。]{2,4})/);
  const sisterMatch = outline.match(/妹妹.*?(?:名|叫|为|：)\s*[「【]?([^\s「」【】,，。]{2,4})/);
  const bName = brotherMatch?.[1] || '兄';
  const sName = sisterMatch?.[1] || '妹';
  const worldMatch = outline.match(/世界.*?[「【]([^」】]+)/);
  const worldName = worldMatch?.[1]?.slice(0, 4) || '';

  if (worldName) names.push(`${worldName}：${bName}与${sName}`);
  names.push(`异界兄妹：${bName}与${sName}的冒险`);
  names.push(`${bName}${sName}传`);
  while (names.length < 3) names.push(`异界兄妹录·卷${names.length}`);
  return names.slice(0, 3);
}

function extractAISuggestedNames(outline: string): string[] {
  // Try to extract AI-generated book names from outline
  const nameSection = outline.match(/(?:推荐书名|书名建议|书名推荐)[\s\S]*?\n([\s\S]*?)(?:\n##|\n\n\n|$)/);
  if (nameSection) {
    const lines = nameSection[1].split('\n').filter(l => l.trim());
    return lines.slice(0, 3).map(l => 
      l.replace(/^[\d.、．\-*）]+\s*/, '')
       .replace(/[「」【】《》]/g, '')
       .trim()
    ).filter(Boolean);
  }
  return [];
}

export function OutlineConfirmDialog({
  open, onOpenChange, outlineContent, onConfirm, onRegenerate, onEditOutline, isRegenerating,
  pastedOutline, aiSuggestedNames,
}: OutlineConfirmDialogProps) {
  const [bookTitle, setBookTitle] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showPastedOutline, setShowPastedOutline] = useState(false);

  const extractedAINames = useMemo(() => extractAISuggestedNames(outlineContent), [outlineContent]);
  const fallbackNames = useMemo(() => generateSuggestedNames(outlineContent), [outlineContent]);
  const suggestedNames = (aiSuggestedNames && aiSuggestedNames.length > 0) 
    ? aiSuggestedNames 
    : (extractedAINames.length > 0 ? extractedAINames : fallbackNames);

  const handleStartEditing = () => {
    setEditContent(outlineContent);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    onEditOutline(editContent);
    setIsEditing(false);
  };

  const handleConfirm = () => {
    const title = bookTitle.trim() || suggestedNames[0] || '未命名';
    onConfirm(title);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="font-heading text-xl">📖 大纲已生成 — 请确认</DialogTitle>
        </DialogHeader>

        {/* Scrollable outline area */}
        <div className="flex-1 min-h-0 px-6 overflow-hidden">
          {showPastedOutline ? (
            <div className="h-full overflow-y-auto border rounded-md p-4 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">你之前粘贴的大纲</Label>
                <Button variant="ghost" size="sm" onClick={() => setShowPastedOutline(false)} className="text-xs">
                  返回大纲
                </Button>
              </div>
              <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground select-all">
                {pastedOutline || '（没有粘贴过大纲）'}
              </pre>
            </div>
          ) : isEditing ? (
            <Textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="w-full h-full text-xs font-mono resize-none"
            />
          ) : (
            <div className="h-full overflow-y-auto border rounded-md p-4 bg-muted/30">
              <div className="prose prose-sm max-w-none text-xs">
                <ReactMarkdown>{outlineContent}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>

        {/* Bottom section */}
        <div className="shrink-0 px-6 pb-6 pt-3 space-y-3 border-t border-border">
          <div>
            <Label className="text-sm font-semibold">为你的作品命名</Label>
            <Input
              value={bookTitle}
              onChange={e => setBookTitle(e.target.value)}
              placeholder="输入书名..."
              className="mt-1"
            />
            <div className="flex gap-1 mt-2 flex-wrap">
              {suggestedNames.map((name, i) => (
                <button
                  key={i}
                  onClick={() => setBookTitle(name)}
                  className="text-xs px-2 py-1 rounded-full border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors"
                >
                  <Sparkles className="h-3 w-3 inline mr-1" />
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            {pastedOutline && (
              <Button
                onClick={() => setShowPastedOutline(!showPastedOutline)}
                variant="outline"
                className="gap-1"
              >
                <FileText className="h-3 w-3" />
                {showPastedOutline ? '返回大纲' : '查看原始大纲'}
              </Button>
            )}
            {isEditing ? (
              <Button onClick={handleSaveEdit} variant="outline" className="gap-1">
                <Check className="h-3 w-3" /> 保存修改
              </Button>
            ) : (
              <Button onClick={handleStartEditing} variant="outline" className="gap-1">
                <Edit3 className="h-3 w-3" /> 修改大纲
              </Button>
            )}
            <Button onClick={onRegenerate} variant="outline" disabled={isRegenerating}>
              {isRegenerating ? '重新生成中...' : '重新生成大纲'}
            </Button>
            <Button onClick={handleConfirm} className="gap-1 theme-glow font-heading" disabled={isRegenerating}>
              确认并开始写作
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
