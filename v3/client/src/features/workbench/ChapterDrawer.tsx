/**
 * 章节目录抽屉（B 视图，设计 §7.1）：移动端左缘滑出 / 桌面按钮唤起
 *
 * 列出全部章标题（chapter 元数据），点击滚动定位到对应章节锚点；
 * 每章「▶」从该章开始朗读（用户反馈④：可以选择从哪开始读）。
 */
import { useEffect, useState } from 'react';

import { chapterAnchorId } from './ReadingView';

export interface ChapterRef {
  index: number;
  title: string;
}

interface ChapterDrawerProps {
  open: boolean;
  onClose: () => void;
  chapters: ChapterRef[];
  onLocate: (index: number) => void;
  /** 从该章开始朗读（宿主接 tts store requestStart；队列下标=升序渲染下标） */
  onSpeak?: (queueIdx: number) => void;
  /** 章节改名（用户需求）：传入后每章显示 ✏️（行内编辑，Enter/失焦保存） */
  onRename?: (index: number, title: string) => Promise<void>;
}

export default function ChapterDrawer({ open, onClose, chapters, onLocate, onSpeak, onRename }: ChapterDrawerProps) {
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveRename(index: number): Promise<void> {
    const title = draft.trim();
    if (!onRename || !title || busy) return;
    setBusy(true);
    try {
      await onRename(index, title);
      setRenamingIndex(null);
    } catch {
      alert('章节改名失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  // Esc 关闭（桌面端习惯）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* 遮罩 */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      {/* 左缘抽屉 */}
      <aside
        aria-label="章节目录"
        data-testid="chapter-drawer"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80vw] flex-col bg-[hsl(var(--surface))] shadow-xl transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="safe-top flex items-center justify-between border-b border-[hsl(var(--border-soft))] px-4 pb-3 pt-4">
          <h2 className="text-base font-semibold">章节目录</h2>
          <span className="text-xs text-[hsl(var(--fg-muted))]">共 {chapters.length} 章</span>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto py-2">
          {chapters.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-[hsl(var(--fg-muted))]">暂无章节</p>
          )}
          {chapters.map((c, i) => (
            <div key={c.index} className="flex min-h-10 items-center gap-1 px-4 transition-colors hover:bg-[hsl(var(--bg))]">
              {onRename && renamingIndex === c.index ? (
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveRename(c.index);
                    if (e.key === 'Escape') setRenamingIndex(null);
                  }}
                  onBlur={() => void saveRename(c.index)}
                  autoFocus
                  aria-label={`第${c.index}章新标题`}
                  data-testid={`drawer-rename-input-${c.index}`}
                  disabled={busy}
                  className="min-h-10 flex-1 rounded-md border border-[hsl(var(--accent))] bg-[hsl(var(--bg))] px-2 text-sm outline-none disabled:opacity-50"
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onLocate(c.index);
                      onClose();
                    }}
                    className="flex min-h-10 flex-1 items-center gap-2 py-2 text-left text-sm hover:text-[hsl(var(--accent))]"
                  >
                    <span className="shrink-0 text-xs text-[hsl(var(--fg-muted))]">{c.index}</span>
                    <span className="truncate">{c.title}</span>
                  </button>
                  {onRename && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(c.title);
                        setRenamingIndex(c.index);
                      }}
                      aria-label={`重命名 第${c.index}章`}
                      data-testid={`drawer-rename-btn-${c.index}`}
                      title="改章节名"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[hsl(var(--fg-muted))] transition-colors hover:bg-[hsl(var(--muted))]/40 hover:text-[hsl(var(--accent))]"
                    >
                      ✏️
                    </button>
                  )}
                </>
              )}
              {onSpeak && (
                <button
                  type="button"
                  title={`从本章开始朗读：${c.title}`}
                  aria-label={`从第${c.index}章开始朗读`}
                  data-testid={`drawer-speak-${i}`}
                  onClick={() => {
                    onSpeak(i);
                    onClose();
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[hsl(var(--fg-muted))] transition-colors hover:bg-[hsl(var(--muted))]/40 hover:text-[hsl(var(--accent))]"
                >
                  ▶
                </button>
              )}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

/** 滚动定位到章节锚点（ReadingView 滚动容器内） */
export function scrollToChapter(index: number): void {
  document.getElementById(chapterAnchorId(index))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
