/**
 * 评论总结视图（共识 D7）：全书评论按类型分组，标注章节 + 版本 + 原句
 * 找不到归属章节的评论（章节被删等）标「原文已变」仍展示，不丢数据。
 */
import { X } from 'lucide-react';
import type { Comment, CommentType } from '@shared/comment';

type ChapterRef = { msg: { id: string; chapter: { index: number; title: string } }; version: { id: string; name: string } };

const TYPES: readonly CommentType[] = ['改错', '添加', '感悟'];

const TYPE_STYLE: Record<CommentType, string> = {
  改错: 'bg-red-500/10 text-red-600 dark:text-red-400',
  添加: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  感悟: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

export default function CommentSummary({
  comments,
  chapters,
  onClose,
}: {
  comments: readonly Comment[];
  chapters: readonly ChapterRef[];
  onClose: () => void;
}) {
  const byChapter = new Map(chapters.map((c) => [c.msg.id, c]));

  return (
    <div className="m-fade fixed inset-0 z-50 flex flex-col bg-[hsl(var(--bg))] text-[hsl(var(--fg))]" data-testid="comment-summary">
      <header className="safe-top flex shrink-0 items-center gap-2 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2">
        <button type="button" onClick={onClose} className="flex h-9 min-w-9 items-center justify-center rounded-lg" aria-label="关闭总结">
          <X className="h-5 w-5" aria-hidden />
        </button>
        <h1 className="flex-1 text-sm font-semibold">评论总结（{comments.length}）</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {comments.length === 0 && (
          <p className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">还没有评论——阅读时长按划线即可批注</p>
        )}
        {TYPES.map((t) => {
          const group = comments.filter((c) => c.type === t);
          if (group.length === 0) return null;
          return (
            <section key={t} className="mb-4">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <span className={`rounded-full px-2 py-0.5 text-xs ${TYPE_STYLE[t]}`}>{t}</span>
                <span className="text-xs font-normal text-[hsl(var(--fg-muted))]">{group.length} 条</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {group.map((c) => {
                  const ch = byChapter.get(c.chapterMsgId);
                  const versionOk = ch?.version.id === c.versionId;
                  return (
                    <li key={c.id} className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3 text-xs">
                      <p className="mb-1 text-[10px] text-[hsl(var(--fg-muted))]">
                        {c.author?.name ?? '作者'} · 第{c.chapterIndex}章 {ch?.msg.chapter.title ?? ''}
                        {ch && !versionOk && ' · 原文已变'}
                        {!ch && ' · 章节已删除'}
                      </p>
                      <p className="leading-5 text-[hsl(var(--fg-muted))]">「{c.quote.length > 50 ? `${c.quote.slice(0, 50)}…` : c.quote}」</p>
                      {c.text && <p className="mt-1 leading-5">{c.text}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
