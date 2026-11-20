/**
 * 章节导航域（同域两件）：顶部横向 chips 条 + 左滑抽屉目录。
 *
 * - ChapterChips：横向滚动 chips，选中高亮（正文/版本分区共用）
 * - ChapterDrawer：左侧滑入抽屉（章号+标题+字数），点选切换。用户痛点：正文写完一章后
 *   要滚回页面顶端才能切章——抽屉入口悬浮在左下角不随滚动移动，任意位置一键呼出。
 *   遮罩点击关闭，动画复用 m-fade/m-drawer-left。
 * - 章节改名（用户需求）：抽屉每章 ✏️ 行内编辑标题（Enter/失焦保存，PATCH 幂等覆盖）。
 */
import { useState } from 'react';

import { chapterChip, chapterTitle } from '../../../../lib/chapter-title';
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
    <div className="scrollbar-none flex gap-1.5 overflow-x-auto px-4 py-2" data-testid="chapter-chips">
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

/** 章节字数（当前激活版本正文字符数，空章显示 0） */
function charCount(c: ChapterMsg): number {
  return c.content.length;
}

export function ChapterDrawer({
  open,
  chapters,
  currentId,
  onPick,
  onClose,
  onRename,
}: {
  open: boolean;
  chapters: readonly ChapterMsg[];
  currentId: string | undefined;
  onPick: (id: string) => void;
  onClose: () => void;
  /** 章节改名（用户需求）：传入后每章显示 ✏️（行内编辑，Enter/失焦保存） */
  onRename?: (id: string, title: string) => Promise<void>;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveRename(c: ChapterMsg): Promise<void> {
    const title = draft.trim();
    if (!onRename || !title || busy) return;
    setBusy(true);
    try {
      await onRename(c.id, title);
      setRenamingId(null);
    } catch {
      alert('章节改名失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex" data-testid="chapter-drawer">
      {/* 遮罩（点空白关闭） */}
      <button type="button" aria-label="关闭目录" onClick={onClose} className="m-fade min-w-0 flex-1 bg-black/45" />
      {/* 左侧面板 */}
      <div className="m-drawer-left flex h-full w-72 flex-col border-r border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-[hsl(var(--border-soft))] px-4 py-3">
          <h3 className="m-serif text-sm font-semibold">章节目录（{chapters.length}）</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="drawer-close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg))]"
          >
            ✕
          </button>
        </div>
        <div className="m-stagger min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {chapters.map((c) => {
            const active = c.id === currentId;
            if (onRename && renamingId === c.id) {
              return (
                <div key={c.id} className="mb-1 rounded-lg border border-[hsl(var(--accent))]/50 bg-[hsl(var(--accent))]/5 p-2" data-testid={`drawer-rename-${c.chapter.index}`}>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveRename(c);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    autoFocus
                    aria-label={`第${c.chapter.index}章新标题`}
                    disabled={busy}
                    className="mb-1.5 w-full rounded-lg border border-[hsl(var(--accent))] bg-[hsl(var(--bg))] px-2 py-1.5 text-sm outline-none"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void saveRename(c)}
                      disabled={busy || !draft.trim()}
                      className="h-8 flex-1 rounded-lg bg-[hsl(var(--accent))] text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
                    >
                      {busy ? '保存中…' : '保存'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="h-8 flex-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg-muted))]"
                    >
                      取消
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div key={c.id} className="flex min-h-10 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    onPick(c.id);
                    onClose();
                  }}
                  data-testid={`drawer-ch-${c.chapter.index}`}
                  className={`mb-1 flex min-h-10 flex-1 flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left ${
                    active
                      ? 'bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
                      : 'text-[hsl(var(--fg))] hover:bg-[hsl(var(--bg))]'
                  }`}
                >
                  <span className="w-full truncate text-sm">{chapterTitle(c.chapter.index, c.chapter.title)}</span>
                  <span className="text-[11px] text-[hsl(var(--fg-muted))]">{charCount(c)} 字</span>
                </button>
                {onRename && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(c.chapter.title);
                      setRenamingId(c.id);
                    }}
                    aria-label={`重命名 第${c.chapter.index}章`}
                    data-testid={`drawer-rename-btn-${c.chapter.index}`}
                    title="改章节名"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg))] hover:text-[hsl(var(--accent))]"
                  >
                    ✏️
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
