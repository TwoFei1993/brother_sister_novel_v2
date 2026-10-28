/**
 * 阅读器内联小件（自 Reader 拆出）：段内划线高亮 + 批注备注输入。
 * 均为无状态展示组件，交互回调由 Reader 提供。
 */
import { useState } from 'react';
import type { Comment } from '@shared/comment';

/** 段内高亮：quote 去上下文核心匹配尽力而为；匹配不到原样渲染（失效标记在批注列表） */
export function HighlightedPara({ para, comments }: { para: string; comments: readonly Comment[] }) {
  let nodes: React.ReactNode = para;
  for (const c of comments) {
    const probe = c.quote.length > 24 ? c.quote.slice(8, 20) : c.quote.slice(0, Math.min(12, c.quote.length));
    const idx = para.indexOf(probe);
    if (idx < 0) continue;
    const start = Math.max(0, idx - 8);
    const end = Math.min(para.length, idx + probe.length + 8);
    nodes = (
      <>
        {para.slice(0, start)}
        <mark className="rounded bg-amber-300/40 px-0.5 dark:bg-amber-500/30" data-testid="highlight">
          {para.slice(start, end)}
        </mark>
        {para.slice(end)}
      </>
    );
    break;
  }
  return <>{nodes}</>;
}

/** 备注输入（可选）：感悟常带正文，改错/添加直接点类型即可 */
export function CommentNoteInput({ onSubmit }: { onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <div className="flex gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="补充备注（可选）"
        data-testid="comment-note-input"
        className="h-10 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
      />
      <button
        type="button"
        onClick={() => note.trim() && onSubmit(note.trim())}
        disabled={!note.trim()}
        className="h-10 rounded-xl bg-[hsl(var(--accent))] px-4 text-sm text-[hsl(var(--accent-fg))] disabled:opacity-40"
      >
        发感悟
      </button>
    </div>
  );
}
