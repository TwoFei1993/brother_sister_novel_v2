/**
 * 底部阅读菜单（自 Reader 拆出）：点中央呼出——上一章 | 章节进度滑块 | 下一章 + 章内百分比。
 */
import { List, FileText } from 'lucide-react';

interface ReaderMenuProps {
  chapterNo: number;
  lastChapterNo: number;
  chapterIdx: number;
  total: number;
  scrollPct: number;
  onJump: (idx: number) => void;
  onCatalog: () => void;
  onSummary: () => void;
}

export default function ReaderMenu({
  chapterNo,
  lastChapterNo,
  chapterIdx,
  total,
  scrollPct,
  onJump,
  onCatalog,
  onSummary,
}: ReaderMenuProps) {
  return (
    <div
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]/95 px-4 pb-3 pt-3 backdrop-blur-sm"
      data-testid="reader-menu"
    >
      <div className="mb-2 flex items-center justify-between text-xs text-[hsl(var(--fg-muted))]" data-testid="reader-progress">
        <span>
          第 {chapterNo}/{lastChapterNo} 章
        </span>
        <span>本章 {scrollPct}%</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onJump(chapterIdx - 1)}
          disabled={chapterIdx <= 0}
          data-testid="reader-prev-chapter"
          className="h-9 shrink-0 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs disabled:opacity-40"
        >
          上一章
        </button>
        <input
          type="range"
          min={0}
          max={total - 1}
          value={chapterIdx}
          onChange={(e) => onJump(Number(e.target.value))}
          data-testid="reader-progress-slider"
          aria-label="章节进度"
          className="h-1.5 min-w-0 flex-1 accent-[hsl(var(--accent))]"
        />
        <button
          type="button"
          onClick={() => onJump(chapterIdx + 1)}
          disabled={chapterIdx >= total - 1}
          data-testid="reader-next-chapter"
          className="h-9 shrink-0 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs disabled:opacity-40"
        >
          下一章
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onCatalog}
          data-testid="menu-catalog-btn"
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border-soft))] text-xs"
        >
          <List className="h-4 w-4" aria-hidden />
          目录
        </button>
        <button
          type="button"
          onClick={onSummary}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border-soft))] text-xs"
        >
          <FileText className="h-4 w-4" aria-hidden />
          评论总结
        </button>
      </div>
    </div>
  );
}
