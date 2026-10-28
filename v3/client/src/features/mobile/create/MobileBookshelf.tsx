/**
 * 移动创作书架（/m/create）：全部作品列表 + 新建入口
 *
 * 数据复用 listWorks；卡片点击进 /m/work/:id 创作中。新建走精简对话框
 * （标题+模式），绑定资产等高级设置留在桌面端/后续向导（对话大纲 Phase2）。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { createWork, listWorks, type WorkSummary } from '../../../api/works';

const GENRES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'xuanhuan', label: '玄幻' },
  { value: 'chuanyue', label: '穿越' },
  { value: 'scifi', label: '科幻' },
  { value: 'moshi', label: '末世' },
  { value: 'wuxian', label: '无限' },
  { value: 'hunhe', label: '混合' },
];

function NewWorkDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('xuanhuan');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await createWork({ title: t, mode: 'novel', genre });
      onCreated();
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
        <div className="mb-4 flex flex-wrap gap-2">
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
        <button
          type="button"
          data-testid="new-work-submit"
          disabled={!title.trim() || busy}
          onClick={() => void submit()}
          className="h-11 w-full rounded-lg bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
        >
          {busy ? '创建中…' : '创建'}
        </button>
      </div>
    </div>
  );
}

export default function MobileBookshelf() {
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  function reload(): void {
    listWorks()
      .then((list) => setWorks([...list].sort((a, b) => b.updatedAt - a.updatedAt)))
      .catch(() => setWorks([]));
  }
  useEffect(reload, []);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-4 pt-5">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <p className="m-serif text-[11px] tracking-[0.5em] text-[hsl(var(--fg-muted))]">書 房</p>
          <h1 className="m-serif mt-0.5 text-2xl font-semibold leading-tight">创作</h1>
        </div>
        <button
          type="button"
          data-testid="new-work-btn"
          onClick={() => setDialogOpen(true)}
          className="m-seal-btn h-10 rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] transition-transform active:scale-95"
        >
          ＋ 新建
        </button>
      </header>

      {works === null && <p className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">书架加载中…</p>}
      {works?.length === 0 && (
        <p className="py-16 text-center text-sm leading-6 text-[hsl(var(--fg-muted))]">
          还没有作品
          <br />
          点右上角「新建」，开始你的第一本书
        </p>
      )}
      <div className="m-rise flex flex-col gap-2.5">
        {works?.map((w) => (
          <Link
            key={w.id}
            to={`/m/work/${w.id}`}
            data-testid={`shelf-item-${w.id}`}
            className="m-book-card flex items-center gap-3 px-4 py-3"
          >
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
        ))}
      </div>

      {dialogOpen && <NewWorkDialog onClose={() => setDialogOpen(false)} onCreated={reload} />}
    </div>
  );
}
