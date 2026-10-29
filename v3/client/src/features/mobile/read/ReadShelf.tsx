/**
 * 移动阅读书架（/m/read）：封面网格书架（微信读书式，与创作书架同交互）
 *
 * - 只读已上架的书（publishedChapterCount>0）
 * - 网格视图：分组组合封面卡（2×2 拼图）+ 未分类平铺；点组合卡进入该组网格
 * - 「管理」（仅作者）：多选 → 移动到分组（PATCH work.shelfTag；读者账号无此权限）
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { getWork, listWorks, updateWork, type WorkSummary } from '../../../api/works';
import { useAuthStore } from '../../../stores/auth';
import { ShelfBookCover, ShelfGroupCard } from '../ShelfCover';

/** 分组：tag → 组内按 updatedAt 新→旧；「未分类」殿后，其余标签按中文序（创作/阅读书架共用） */
export function groupByTag(works: WorkSummary[]): [string, WorkSummary[]][] {
  const byTag = new Map<string, WorkSummary[]>();
  for (const w of works) {
    const tag = w.shelfTag?.trim() || '未分类';
    (byTag.get(tag) ?? byTag.set(tag, []).get(tag)!).push(w);
  }
  const tags = [...byTag.keys()].sort((a, b) => (a === '未分类' ? 1 : b === '未分类' ? -1 : a.localeCompare(b, 'zh')));
  return tags.map((t) => [t, [...byTag.get(t)!].sort((a, b) => b.updatedAt - a.updatedAt)] as [string, WorkSummary[]]);
}

/** 「移动到分组」弹层（创作/阅读书架同交互） */
function MoveSheet({
  count,
  tags,
  busy,
  onPick,
  onClose,
}: {
  count: number;
  tags: readonly string[];
  busy: boolean;
  onPick: (tag: string) => void;
  onClose: () => void;
}) {
  const [newTag, setNewTag] = useState('');
  return (
    <div className="m-fade fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <div
        className="m-sheet safe-bottom max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-[hsl(var(--surface))] p-4"
        onClick={(e) => e.stopPropagation()}
        data-testid="read-move-sheet"
      >
        <h3 className="mb-3 text-sm font-semibold">移动 {count} 本到分组</h3>
        <button
          type="button"
          onClick={() => onPick('')}
          disabled={busy}
          className="mb-3 h-10 w-full rounded-lg border border-[hsl(var(--border-soft))] text-sm"
        >
          📚 未分类（移出当前分组）
        </button>
        {tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onPick(t)}
                disabled={busy}
                className="h-9 rounded-full border border-[hsl(var(--border-soft))] px-3.5 text-xs"
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="新建分组名…"
            aria-label="新建分组名"
            className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
          />
          <button
            type="button"
            onClick={() => onPick(newTag.trim())}
            disabled={busy || !newTag.trim()}
            className="h-10 shrink-0 rounded-lg bg-[hsl(var(--accent))] px-4 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
          >
            新建并移入
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReadShelf() {
  const navigate = useNavigate();
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 当前进入的分组（null=书架总览） */
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAuthor = useAuthStore((s) => s.user?.role === 'author');

  useEffect(() => {
    listWorks()
      .then((list) => setWorks([...list].filter((w) => (w.stats?.publishedChapterCount ?? 0) > 0)))
      .catch(() => setWorks([]));
  }, []);

  const groups = useMemo(() => (works ? groupByTag(works) : []), [works]);
  const allTags = useMemo(() => groups.map(([t]) => t).filter((t) => t !== '未分类'), [groups]);
  const uncategorized = useMemo(() => groups.find(([t]) => t === '未分类')?.[1] ?? [], [groups]);

  function toggleSelect(id: string): void {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 批量移动到分组（作者）：逐本取 revision → PATCH shelfTag（乐观锁） */
  async function moveTo(tag: string): Promise<void> {
    if (busy || selected.size === 0) return;
    setBusy(true);
    try {
      for (const id of selected) {
        const full = await getWork(id);
        await updateWork(id, { revision: full.revision, shelfTag: tag });
      }
      setWorks((ws) => (ws ?? []).map((x) => (selected.has(x.id) ? { ...x, shelfTag: tag || undefined } : x)));
      setSelected(new Set());
      setMoveOpen(false);
      setManaging(false);
    } catch {
      alert('移动失败（可能版本冲突），请重试');
    } finally {
      setBusy(false);
    }
  }

  function renderCover(w: WorkSummary): ReactNode {
    const badges = [`已上架 ${w.stats?.publishedChapterCount ?? 0}/${w.stats?.chapterCount ?? 0} 章`];
    return (
      <div key={w.id} data-testid={`read-shelf-item-${w.id}`} className="flex">
        {managing ? (
          <ShelfBookCover book={w} manage checked={selected.has(w.id)} badges={badges} onClick={() => toggleSelect(w.id)} />
        ) : (
          <ShelfBookCover book={w} badges={badges} onClick={() => navigate(`/m/read/${w.id}`)} />
        )}
      </div>
    );
  }

  const grid = 'm-stagger grid grid-cols-3 gap-x-3 gap-y-4 px-4';

  return (
    <div className="mx-auto max-w-2xl px-4 pb-4 pt-4">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <p className="m-serif text-[11px] tracking-[0.5em] text-[hsl(var(--fg-muted))]">書 房</p>
          <h1 className="m-serif mt-0.5 text-2xl font-semibold leading-tight">{activeTag ?? '阅读'}</h1>
        </div>
        {isAuthor && (
          <button
            type="button"
            onClick={() => {
              setManaging((m) => !m);
              setSelected(new Set());
            }}
            data-testid="read-shelf-tidy-btn"
            className={`h-10 rounded-lg border px-3 text-xs ${
              managing ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]' : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
            }`}
          >
            {managing ? '完成' : '📋 管理'}
          </button>
        )}
      </header>

      {works === null && <p className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">书架加载中…</p>}
      {works?.length === 0 && (
        <div className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">
          <p>还没有可阅读的书</p>
          <p className="mt-2 text-xs">在「创作」里给章节上架后，就会出现在这里</p>
        </div>
      )}

      {/* 分组内视图：该组封面网格 */}
      {activeTag !== null &&
        works !== null &&
        (() => {
          const list = groups.find(([t]) => t === activeTag)?.[1] ?? [];
          return (
            <>
              <button
                type="button"
                onClick={() => setActiveTag(null)}
                data-testid="read-group-back-btn"
                className="mb-3 ml-1 rounded-lg px-2 py-1 text-xs text-[hsl(var(--fg-muted))]"
              >
                ← 全部分组
              </button>
              <div className={grid}>{list.map((w) => renderCover(w))}</div>
            </>
          );
        })()}

      {/* 书架总览：分组组合封面 + 未分类平铺 */}
      {activeTag === null && works !== null && (
        <>
          <div className={`${grid} mb-2`}>
            {allTags.map((t) => {
              const list = groups.find(([g]) => g === t)?.[1] ?? [];
              return <ShelfGroupCard key={t} tag={t} books={list} onClick={() => setActiveTag(t)} />;
            })}
          </div>
          {uncategorized.length > 0 && (
            <>
              {allTags.length > 0 && (
                <h2 className="m-serif mb-2 px-1 text-xs tracking-widest text-[hsl(var(--fg-muted))]">
                  ◈ 未分类 · {uncategorized.length} 本
                </h2>
              )}
              <div className={grid}>{uncategorized.map((w) => renderCover(w))}</div>
            </>
          )}
        </>
      )}

      {/* 管理模式底部操作条（仅作者：多选 → 移动到分组） */}
      {managing && selected.size > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-4 py-3" data-testid="read-manage-bar">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <span className="shrink-0 text-xs text-[hsl(var(--fg-muted))]">已选 {selected.size} 本</span>
            <button
              type="button"
              onClick={() => setMoveOpen(true)}
              disabled={busy}
              data-testid="read-move-open-btn"
              className="h-10 flex-1 rounded-xl bg-[hsl(var(--accent))] text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
            >
              移动到分组…
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="h-10 flex-1 rounded-xl border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg-muted))]"
            >
              取消选择
            </button>
          </div>
        </div>
      )}

      {moveOpen && (
        <MoveSheet count={selected.size} tags={allTags} busy={busy} onPick={(tag) => void moveTo(tag)} onClose={() => setMoveOpen(false)} />
      )}
    </div>
  );
}
