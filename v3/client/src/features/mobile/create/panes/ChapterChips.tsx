/**
 * 章节选择条：横向滚动 chips，选中高亮（正文/版本分区共用）。
 */
import { chapterChip } from '../../../../lib/chapter-title';
import type { ChapterMsg } from './types';

export function ChapterChips({
  chapters,
  currentId,
  onPick,
}: {
  chapters: readonly ChapterMsg[];
  currentId: string | undefined;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto px-4 py-2" data-testid="chapter-chips">
      {chapters.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          className={`h-7 shrink-0 rounded-full border px-3 text-xs ${
            c.id === currentId
              ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
              : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
          }`}
        >
          {chapterChip(c.chapter.index, c.chapter.title)}
        </button>
      ))}
    </div>
  );
}
