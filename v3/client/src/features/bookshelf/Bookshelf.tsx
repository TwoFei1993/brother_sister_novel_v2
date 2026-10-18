/**
 * 书架（设计 §7.1 /）：作品网格 + 搜索 + 排序 + 新建入口
 *
 * - 网格响应式 2-5 列；封面卡交互见 WorkCard
 * - 搜索按标题过滤；排序：最近更新 / 章节数 / 标题
 *   （浅列表无 createdAt 字段，"创建时间"排序以"标题"替代，见任务汇报偏离说明）
 * - 空态引导"新建作品"；加载失败可重试
 */
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';

import { listWorks } from '../../api/works';
import type { WorkSummary } from '../../api/works';
import WorkCard from './WorkCard';
import NewWorkDialog from './NewWorkDialog';

type SortKey = 'recent' | 'chapters' | 'title';

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'recent', label: '最近更新' },
  { value: 'chapters', label: '章节数' },
  { value: 'title', label: '标题' },
];

export default function Bookshelf() {
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [creating, setCreating] = useState(false);

  function reload(): void {
    setLoading(true);
    setLoadError(false);
    listWorks()
      .then(setWorks)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? works.filter((w) => w.title.toLowerCase().includes(q)) : works;
    const sorted = [...filtered];
    switch (sortBy) {
      case 'chapters':
        sorted.sort((a, b) => (b.stats?.chapterCount ?? 0) - (a.stats?.chapterCount ?? 0));
        break;
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
        break;
      case 'recent':
        sorted.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
    }
    return sorted;
  }, [works, query, sortBy]);

  function handleUpdated(next: WorkSummary): void {
    setWorks((prev) => prev.map((w) => (w.id === next.id ? next : w)));
  }

  function handleDeleted(id: string): void {
    setWorks((prev) => prev.filter((w) => w.id !== id));
  }

  const selectClass =
    'h-10 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 text-sm text-[hsl(var(--fg))] outline-none focus:border-[hsl(var(--accent))]';

  return (
    <section className="safe-x mx-auto w-full max-w-6xl pt-6 pb-16">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">我的书架</h1>
          <p className="mt-0.5 text-xs text-[hsl(var(--fg-muted))]">共 {works.length} 部作品</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder="搜索标题…"
            aria-label="按标题搜索作品"
            className="h-10 w-full min-w-36 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 text-sm outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))] sm:w-44"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            aria-label="排序方式"
            className={selectClass}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="h-10 rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity hover:opacity-90"
          >
            ＋ 新建作品
          </button>
        </div>
      </div>

      {loading && (
        <p className="py-24 text-center text-sm text-[hsl(var(--fg-muted))]">书架加载中…</p>
      )}

      {loadError && (
        <div className="py-24 text-center">
          <p className="mb-4 text-sm text-[hsl(var(--fg-muted))]">书架加载失败，请检查网络后重试</p>
          <button
            type="button"
            onClick={reload}
            className="h-10 rounded-lg border border-[hsl(var(--border-soft))] px-5 text-sm transition-colors hover:border-[hsl(var(--accent))]"
          >
            重新加载
          </button>
        </div>
      )}

      {!loading && !loadError && visible.length === 0 && (
        <div className="py-24 text-center">
          <div className="mb-4 text-5xl" aria-hidden="true">
            {query.trim() ? '🔍' : '📚'}
          </div>
          {query.trim() ? (
            <>
              <p className="text-base">没有找到「{query.trim()}」相关的作品</p>
              <p className="mt-1 text-sm text-[hsl(var(--fg-muted))]">换个关键词试试</p>
            </>
          ) : (
            <>
              <p className="text-base">书架空空如也</p>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mt-5 h-11 rounded-lg bg-[hsl(var(--accent))] px-6 text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity hover:opacity-90"
              >
                ＋ 新建作品
              </button>
            </>
          )}
        </div>
      )}

      {!loading && !loadError && visible.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {visible.map((work) => (
            <WorkCard key={work.id} work={work} onUpdated={handleUpdated} onDeleted={handleDeleted} />
          ))}
        </div>
      )}

      {creating && <NewWorkDialog onClose={() => setCreating(false)} />}
    </section>
  );
}
