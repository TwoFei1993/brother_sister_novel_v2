/**
 * 移动创作书架（/m/create）：全部作品列表 + 新建入口
 *
 * - 文件夹分组（与阅读书架同款）：按 shelfTag 分组（未分类殿后），「整理」模式
 *   上移/下移排序（localStorage 设备级偏好）+ 打标签（PATCH work.shelfTag）
 * - 新建：标题+题材；勾「从手写开始」→ 创建后直达正文手写第一章（写完可 AI 润色）
 */
import { useEffect, useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { createWork, getWork, listWorks, updateWork, type WorkSummary } from '../../../api/works';
import { groupByTag, sortByOrder } from '../read/ReadShelf';

const ORDER_KEY = 'create-shelf-order-v1';

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

export default function MobileBookshelf() {
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [tidying, setTidying] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  function reload(): void {
    listWorks()
      .then((list) => setWorks([...list].sort((a, b) => b.updatedAt - a.updatedAt)))
      .catch(() => setWorks([]));
  }
  useEffect(() => {
    setOrder(loadOrder());
    reload();
  }, []);

  /** 分组：tag → 组内按手动序；「未分类」殿后 */
  const groups = useMemo(() => (works ? groupByTag(works, order) : []), [works, order]);

  function move(id: string, delta: -1 | 1): void {
    const flat = groups.flatMap(([, ws]) => ws.map((w) => w.id));
    const i = flat.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= flat.length) return;
    const next = [...flat];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
    saveOrder(next);
  }

  async function setTag(w: WorkSummary): Promise<void> {
    const tag = prompt(`《${w.title}》的文件夹标签：`, w.shelfTag ?? '');
    if (tag === null) return;
    const trimmed = tag.trim();
    // 浅列表无 revision：先拉全量取 revision 再 PATCH（乐观锁）；空串=未分类
    // （PATCH 是浅合并，undefined 会被 JSON 略过导致旧标签删不掉，必须显式传空串覆盖）
    const full = await getWork(w.id);
    await updateWork(w.id, { revision: full.revision, shelfTag: trimmed });
    setWorks((ws) => (ws ?? []).map((x) => (x.id === w.id ? { ...x, shelfTag: trimmed || undefined } : x)));
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-4 pt-5">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <p className="m-serif text-[11px] tracking-[0.5em] text-[hsl(var(--fg-muted))]">書 房</p>
          <h1 className="m-serif mt-0.5 text-2xl font-semibold leading-tight">创作</h1>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTidying((t) => !t)}
            data-testid="shelf-tidy-btn"
            className={`h-10 rounded-lg border px-3 text-xs ${
              tidying ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]' : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
            }`}
          >
            {tidying ? '完成' : '📁 整理'}
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
          点右上角「新建」，开始你的第一本书
        </p>
      )}

      {groups.map(([tag, ws]) => (
        <section key={tag} className="mb-4">
          <h2 className="m-serif mb-1.5 px-1 text-xs tracking-widest text-[hsl(var(--fg-muted))]">
            ◈ {tag} · {ws.length} 本
          </h2>
          <div className="m-rise flex flex-col gap-2.5">
            {ws.map((w) => (
              <div key={w.id} className="flex items-center gap-2" data-testid={`shelf-item-${w.id}`}>
                <Link to={`/m/work/${w.id}`} className="m-book-card flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
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
                  <span className="m-serif text-xs text-[hsl(var(--fg-muted))]">›</span>
                </Link>
                {tidying && (
                  <span className="flex shrink-0 flex-col gap-1" data-testid={`tidy-${w.id}`}>
                    <button type="button" onClick={() => move(w.id, -1)} aria-label="上移" className="h-7 w-7 rounded border border-[hsl(var(--border-soft))] text-xs">
                      ↑
                    </button>
                    <button type="button" onClick={() => move(w.id, 1)} aria-label="下移" className="h-7 w-7 rounded border border-[hsl(var(--border-soft))] text-xs">
                      ↓
                    </button>
                    <button type="button" onClick={() => void setTag(w)} aria-label="改文件夹" className="h-7 w-7 rounded border border-[hsl(var(--border-soft))] text-xs">
                      <Tag className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {dialogOpen && <NewWorkDialog onClose={() => setDialogOpen(false)} onCreated={reload} />}
    </div>
  );
}
