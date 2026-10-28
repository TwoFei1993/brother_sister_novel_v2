/**
 * 批注视图件（自 Reader 拆出）：本章批注列表（含历史版本折叠态）+ 划线评论浮层。
 * 提交/删除逻辑在 Reader，本文件只做展示与转发。
 */
import type { Comment, CommentType } from '@shared/comment';

import { CommentNoteInput } from './ReaderParts';

/** 本章批注（含历史版本折叠） */
export function CommentsSection({
  comments,
  versionId,
  onRemove,
}: {
  comments: readonly Comment[];
  versionId: string;
  onRemove: (cid: string) => void;
}) {
  if (comments.length === 0) return null;
  return (
    <section className="mx-5 mb-6 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
      <h3 className="mb-2 text-xs font-semibold text-[hsl(var(--fg-muted))]">本章批注（{comments.length}）</h3>
      <ul className="flex flex-col gap-2">
        {comments.map((c) => {
          const stale = c.versionId !== versionId;
          return (
            <li key={c.id} className={`rounded-lg px-3 py-2 text-xs ${stale ? 'opacity-60' : ''}`} data-testid="reader-comment">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="rounded-full bg-[hsl(var(--accent))]/10 px-1.5 text-[10px] text-[hsl(var(--accent))]">{c.type}</span>
                <span className="text-[10px] text-[hsl(var(--fg-muted))]">
                  {c.author?.name ?? '作者'} · v{c.versionName}
                  {stale && ' · 原文已变'}
                </span>
                <button type="button" onClick={() => onRemove(c.id)} className="ml-auto text-[10px] text-[hsl(var(--fg-muted))] underline">
                  删除
                </button>
              </div>
              <p className="text-[hsl(var(--fg-muted))]">「{c.quote.length > 40 ? `${c.quote.slice(0, 40)}…` : c.quote}」</p>
              {c.text && <p className="mt-0.5">{c.text}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 划线评论浮层：三类一键提交 + 备注输入 */
export function CommentSheet({
  pending,
  types,
  onSubmit,
  onDismiss,
}: {
  pending: { raw: string };
  types: readonly CommentType[];
  onSubmit: (type: CommentType, note: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={onDismiss}>
      <div
        className="w-full rounded-t-2xl bg-[hsl(var(--surface))] p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
        data-testid="comment-sheet"
      >
        <p className="mb-3 line-clamp-2 text-xs text-[hsl(var(--fg-muted))]">
          「{pending.raw.slice(0, 60)}
          {pending.raw.length > 60 ? '…' : ''}」
        </p>
        <div className="mb-3 flex gap-2">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onSubmit(t, '')}
              className="h-10 flex-1 rounded-xl border border-[hsl(var(--border-soft))] text-sm"
            >
              {t}
            </button>
          ))}
        </div>
        <CommentNoteInput onSubmit={(note) => onSubmit('感悟', note)} />
      </div>
    </div>
  );
}
