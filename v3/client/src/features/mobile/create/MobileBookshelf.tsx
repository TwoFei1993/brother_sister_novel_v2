/**
 * 移动创作书架（/m/create）：分组书架（微信读书式）+ 新建入口
 *
 * - 分组分区（按 shelfTag，未分类殿后），组头点击折叠/展开（localStorage 记忆）
 * - 「管理」模式：点选书籍（勾选角标）→ 底部「移动到分组」→ 选已有分组或新建分组，批量 PATCH shelfTag
 * - 新建：标题+题材；勾「从手写开始」→ 创建后直达正文手写第一章（写完可 AI 润色）
 * - 🪄 AI 向导：右上直达 /planner（反馈④：向导入口应放在创作页）
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { WandSparkles } from 'lucide-react';

import { createWork, getWork, listWorks, updateWork, type WorkSummary } from '../../../api/works';
import { groupByTag } from '../read/ReadShelf';

const ORDER_KEY = 'create-shelf-order-v1';
const COLLAPSE_KEY = 'create-shelf-collapse-v1';

function loadOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveOrder(ids: string[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {
    /* 存储不可用静默 */
  }
}

function loadCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveCollapsed(tags: string[]): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(tags));
  } catch {
    /* 存储不可用静默 */
  }
}

const GENRES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'xuanhuan', label: '玄幻' },
  { value: 'chuanyue', label: '穿越' },
  { value: 'scifi', label: '科幻' },
  { value: 'moshi', label: '末世' },
  { value: 'wuxian', label: '无限' },
  { value: 'hunhe', label: '混合' },
];

function NewWorkDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('xuanhuan');
  /** 手写模式：创建后直达正文，自己写/粘贴，再用 AI 润色 */
  const [handwrite, setHandwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const work = await createWork({ title: t, mode: 'novel', genre });
      if (handwrite) navigate(`/m/work/${work.id}`);
      else onCreated(work.id);
    } catch {
      alert('创建失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        className="w-full rounded-t-2xl bg-[hsl(var(--surface))] p-4 sm:max-w-sm sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">新建作品</h2>
        <input
          data-testid="new-work-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="书名"
          className="mb-3 h-11 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
        />
        <div className="mb-3 flex flex-wrap gap-2">
          {GENRES.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => setGenre(g.value)}
              className={`h-8 rounded-full border px-3 text-xs ${
                genre === g.value
                  ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
                  : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <label className="mb-4 flex items-center gap-2 text-xs text-[hsl(var(--fg-muted))]" data-testid="new-work-handwrite">
          <input type="checkbox" checked={handwrite} onChange={(e) => setHandwrite(e.target.checked)} />
          ✍️ 从手写开始（自己写/粘贴正文，再用 AI 润色）
        </label>
        <button
          type="button"
          data-testid="new-work-submit"
          disabled={!title.trim() || busy}
          onClick={() => void submit()}
          className="h-11 w-full rounded-lg bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
        >
          {busy ? '创建中…' : handwrite ? '创建并开始手写' : '创建'}
        </button>
      </div>
    </div>
  );
}

/** 「移动到分组」弹层：选已有分组或新建；确认后批量 PATCH shelfTag（空串=未分类） */
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
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <div
        className="safe-bottom max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-[hsl(var(--surface))] p-4"
        onClick={(e) => e.stopPropagation()}
        data-testid="move-sheet"
      >
        <h3 className="mb-3 text-sm font-semibold">移动 {count} 本到分组</h3>
        <button
          type="button"
          onClick={() => onPick('')}
          disabled={busy}
          data-testid="move-uncategorized"
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
                data-testid={`move-tag-${t}`}
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
            data-testid="move-new-tag"
            className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
          />
          <button
            type="button"
            onClick={() => onPick(newTag.trim())}
            disabled={busy || !newTag.trim()}
            data-testid="move-create-tag"
            className="h-10 shrink-0 rounded-lg bg-[hsl(var(--accent))] px-4 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
          >
            新建并移入
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MobileBookshelf() {
  const navigate = useNavigate();
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [managing, setManaging] = useState(false);
  /** 管理模式下勾选的书 */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  function reload(): void {
    listWorks()
      .then((list) => setWorks([...list].sort((a, b) => b.updatedAt - a.updatedAt)))
      .catch(() => setWorks([]));
  }
  useEffect(() => {
    setOrder(loadOrder());
    setCollapsed(loadCollapsed());
    reload();
  }, []);

  /** 分组：tag → 组内按手动序（微信读书式分区，未分类殿后） */
  const groups = useMemo(() => (works ? groupByTag(works, order) : []), [works, order]);
  const allTags = useMemo(() => groups.map(([t]) => t).filter((t) => t !== '未分类'), [groups]);

  function toggleCollapse(tag: string): void {
    setCollapsed((c) => {
      const next = c.includes(tag) ? c.filter((t) => t !== tag) : [...c, tag];
      saveCollapsed(next);
      return next;
    });
  }

  function toggleSelect(id: string): void {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 批量移动到分组：逐本取 revision → PATCH shelfTag（微信读书「移动到分组」语义） */
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

  return (
    <div className="mx-auto max-w-2xl px-4 pb-4 pt-5">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <p className="m-serif text-[11px] tracking-[0.5em] text-[hsl(var(--fg-muted))]">書 房</p>
          <h1 className="m-serif mt-0.5 text-2xl font-semibold leading-tight">创作</h1>
        </div>
        <div className="flex gap-2">
          <Link
            to="/planner"
            data-testid="shelf-wizard-btn"
            className="flex h-10 items-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs text-[hsl(var(--accent))]"
          >
            <WandSparkles className="h-4 w-4" aria-hidden />
            AI 向导
          </Link>
          <button
            type="button"
            onClick={() => {
              setManaging((m) => !m);
              setSelected(new Set());
            }}
            data-testid="shelf-tidy-btn"
            className={`h-10 rounded-lg border px-3 text-xs ${
              managing ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]' : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
            }`}
          >
            {managing ? '完成' : '📋 管理'}
          </button>
          <button
            type="button"
            data-testid="new-work-btn"
            onClick={() => setDialogOpen(true)}
            className="m-seal-btn h-10 rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] transition-transform active:scale-95"
          >
            ＋ 新建
          </button>
        </div>
      </header>

      {works === null && <p className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">书架加载中…</p>}
      {works?.length === 0 && (
        <p className="py-16 text-center text-sm leading-6 text-[hsl(var(--fg-muted))]">
          还没有作品
          <br />
          点右上角「新建」开始一本，或用「AI 向导」从想法起步
        </p>
      )}

      {groups.map(([tag, ws]) => {
        const isCollapsed = collapsed.includes(tag);
        return (
          <section key={tag} className="mb-4">
            <button
              type="button"
              onClick={() => toggleCollapse(tag)}
              data-testid={`shelf-group-${tag}`}
              aria-expanded={!isCollapsed}
              className="mb-1.5 flex w-full items-center gap-1.5 px-1 text-left"
            >
              <span className="m-serif text-xs tracking-widest text-[hsl(var(--fg-muted))]">
                ◈ {tag} · {ws.length} 本
              </span>
              <span className="text-[10px] text-[hsl(var(--fg-muted))]">{isCollapsed ? '▸' : '▾'}</span>
            </button>
            {!isCollapsed && (
              <div className="m-rise flex flex-col gap-2.5">
                {ws.map((w) => {
                  const checked = selected.has(w.id);
                  const card = (
                    <div className="m-book-card flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1 pl-1.5">
                        <p className="m-serif truncate text-[15px] font-medium">{w.title}</p>
                        <p className="mt-0.5 text-xs text-[hsl(var(--fg-muted))]">
                          {w.stats?.chapterCount ?? 0} 章 · {w.stats?.charCount ?? 0} 字
                          {w.mode === 'chat' && ' · 对话'}
                        </p>
                        {(w.stats?.publishedChapterCount ?? 0) > 0 && (
                          <p className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                            已上架 {w.stats?.publishedChapterCount} 章 · 点开可继续写/重roll
                          </p>
                        )}
                      </div>
                      {managing ? (
                        <span
                          data-testid={`pick-${w.id}`}
                          aria-checked={checked}
                          role="checkbox"
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                            checked ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))] text-white' : 'border-[hsl(var(--border-soft))]'
                          }`}
                        >
                          {checked ? '✓' : ''}
                        </span>
                      ) : (
                        <span className="m-serif text-xs text-[hsl(var(--fg-muted))]">›</span>
                      )}
                    </div>
                  );
                  if (managing) {
                    return (
                      <button key={w.id} type="button" onClick={() => toggleSelect(w.id)} className="flex w-full text-left" data-testid={`shelf-item-${w.id}`}>
                        {card}
                      </button>
                    );
                  }
                  return (
                    <Link key={w.id} to={`/m/work/${w.id}`} className="flex" data-testid={`shelf-item-${w.id}`}>
                      {card}
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {/* 管理模式底部操作条（微信读书式：多选 → 移动到分组） */}
      {managing && selected.size > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-4 py-3" data-testid="manage-bar">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <span className="shrink-0 text-xs text-[hsl(var(--fg-muted))]">已选 {selected.size} 本</span>
            <button
              type="button"
              onClick={() => setMoveOpen(true)}
              disabled={busy}
              data-testid="move-open-btn"
              className="h-10 flex-1 rounded-xl bg-[hsl(var(--accent))] text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
            >
              移动到分组…
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="h-10 flex-1 rounded-xl border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg-muted))]">
              取消选择
            </button>
          </div>
        </div>
      )}

      {moveOpen && <MoveSheet count={selected.size} tags={allTags} busy={busy} onPick={(tag) => void moveTo(tag)} onClose={() => setMoveOpen(false)} />}
      {dialogOpen && <NewWorkDialog onClose={() => setDialogOpen(false)} onCreated={reload} />}
    </div>
  );
}
