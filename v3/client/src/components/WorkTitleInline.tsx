/**
 * 顶栏作品名（行内改名，用户需求：作品要能直接改名）：
 * 书名 + ✏️ 按钮 → 行内 input（Enter/失焦保存、Esc 取消）→ PATCH title（乐观锁取全量基准）。
 * 书架卡片改名（WorkCard）之外的写作台/移动端顶栏入口——写作中顺手改名不必回书架。
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { SquarePen } from 'lucide-react';

import { getWork, updateWorkTitle } from '../api/works';
import type { Work } from '@shared/work';

interface WorkTitleInlineProps {
  work: Work;
  /** 改名成功回传最新 Work（宿主同步 store/页面标题） */
  onUpdated: (w: Work) => void;
  /** 书名字号样式（桌面 sm:text-base / 移动端更小由调用方传） */
  titleClassName?: string;
}

export default function WorkTitleInline({ work, onUpdated, titleClassName = 'text-sm font-semibold sm:text-base' }: WorkTitleInlineProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  function start(): void {
    setDraft(work.title);
    cancelled.current = false;
    setError(null);
    setEditing(true);
  }

  async function save(): Promise<void> {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const full = await getWork(work.id); // 浅顶栏无 revision，取全量作乐观锁基准（同 WorkCard 手法）
      const updated = await updateWorkTitle(work.id, { revision: full.revision, title });
      onUpdated(updated);
      setEditing(false);
    } catch {
      setError('改名失败');
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') void save();
    if (e.key === 'Escape') {
      cancelled.current = true;
      setEditing(false);
    }
  }

  function onBlur(): void {
    if (cancelled.current) return;
    if (draft.trim() && draft.trim() !== work.title) void save();
    else setEditing(false);
  }

  if (editing) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          autoFocus
          aria-label="作品新标题"
          disabled={busy}
          data-testid="work-title-input"
          className={`min-w-0 flex-1 truncate rounded-md border border-[hsl(var(--accent))] bg-[hsl(var(--bg))] px-2 py-1 outline-none ${titleClassName}`}
        />
        {error && <span className="shrink-0 text-[10px] text-[hsl(var(--danger))]">{error}</span>}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <h1 className={`min-w-0 truncate ${titleClassName}`} data-testid="work-title">
        {work.title}
      </h1>
      <button
        type="button"
        onClick={start}
        title="改名"
        aria-label={`重命名 ${work.title}`}
        data-testid="work-title-rename"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[hsl(var(--fg-muted))] transition-colors hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--fg))]"
      >
        <SquarePen className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  );
}
