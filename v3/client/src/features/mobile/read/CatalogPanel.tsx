/**
 * 阅读目录面板（番茄式）：全部上架章节列表，点击直接跳章读取。
 * 从 Reader 传入已上架章节（含上架版本），当前章高亮。
 */
export interface CatalogChapter {
  msgId: string;
  index: number;
  title: string;
}

export default function CatalogPanel({
  chapters,
  currentIndex,
  onPick,
  onClose,
}: {
  chapters: readonly CatalogChapter[];
  currentIndex: number;
  onPick: (i: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[hsl(var(--bg))] text-[hsl(var(--fg))]" data-testid="catalog-panel">
      <header className="safe-top flex shrink-0 items-center gap-2 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2">
        <button type="button" onClick={onClose} aria-label="关闭目录" className="flex h-9 min-w-9 items-center justify-center rounded-lg">
          ✕
        </button>
        <h1 className="m-serif flex-1 text-sm font-semibold">目录 · {chapters.length} 章</h1>
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto py-2">
        {chapters.map((c, i) => (
          <li key={c.msgId}>
            <button
              type="button"
              onClick={() => {
                onPick(i);
                onClose();
              }}
              data-testid={`catalog-item-${c.index}`}
              className={`flex w-full items-center gap-3 px-5 py-3 text-left text-sm transition-colors ${
                i === currentIndex ? 'bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]' : ''
              }`}
            >
              <span className="m-serif w-10 shrink-0 text-xs text-[hsl(var(--fg-muted))]">{String(c.index).padStart(2, '0')}</span>
              <span className="m-serif min-w-0 flex-1 truncate">{c.title || '未命名'}</span>
              {i === currentIndex && <span className="text-xs">← 当前</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
