/**
 * 移动阅读书架（/m/read，Phase2 分类+排序）
 *
 * - 只读已上架的书（publishedChapterCount>0）
 * - 按 shelfTag 分组（未分类殿后），组内按手动排序；顺序存 localStorage（单用户设备级偏好）
 * - 「整理」模式：条目上移/下移 + 打标签（PATCH work.shelfTag）
 */
import { useEffect, useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
import { Link } from 'react-router-dom';

import { getWork, listWorks, updateWork, type WorkSummary } from '../../../api/works';
import { useAuthStore } from '../../../stores/auth';

const ORDER_KEY = 'read-shelf-order-v1';

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
  localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
}

/** 排序：手动 order 优先（缺位按 updatedAt 新→旧追加），未分类组内同样规则 */
export function sortByOrder(list: WorkSummary[], order: string[]): WorkSummary[] {
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...list].sort(
    (a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity) || b.updatedAt - a.updatedAt,
  );
}

/** 分组：tag → 组内按手动序；「未分类」殿后，其余标签按中文序 */
export function groupByTag(works: WorkSummary[], order: string[]): [string, WorkSummary[]][] {
  const byTag = new Map<string, WorkSummary[]>();
  for (const w of works) {
    const tag = w.shelfTag?.trim() || '未分类';
    (byTag.get(tag) ?? byTag.set(tag, []).get(tag)!).push(w);
  }
  const tags = [...byTag.keys()].sort((a, b) => (a === '未分类' ? 1 : b === '未分类' ? -1 : a.localeCompare(b, 'zh')));
  return tags.map((t) => [t, sortByOrder(byTag.get(t)!, order)] as [string, WorkSummary[]]);
}

export default function ReadShelf() {
  const [works, setWorks] = useState<WorkSummary[] | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [tidying, setTidying] = useState(false);
  const isAuthor = useAuthStore((s) => s.user?.role === 'author');

  useEffect(() => {
    setOrder(loadOrder());
    listWorks()
      .then((list) => setWorks([...list].filter((w) => (w.stats?.publishedChapterCount ?? 0) > 0)))
      .catch(() => setWorks([]));
  }, []);

  /** 分组：tag → 该组按手动序；「未分类」殿后 */
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
    const tag = prompt(`《${w.title}》的分类标签：`, w.shelfTag ?? '');
    if (tag === null) return;
    const trimmed = tag.trim();
    // 浅列表无 revision：先拉全量取 revision 再 PATCH（乐观锁）；空串=未分类
    // （PATCH 是浅合并，undefined 会被 JSON 略过导致旧标签删不掉，必须显式传空串覆盖）
    const full = await getWork(w.id);
    await updateWork(w.id, { revision: full.revision, shelfTag: trimmed });
    setWorks((ws) => (ws ?? []).map((x) => (x.id === w.id ? { ...x, shelfTag: trimmed || undefined } : x)));
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-4 pt-4">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <p className="m-serif text-[11px] tracking-[0.5em] text-[hsl(var(--fg-muted))]">書 房</p>
          <h1 className="m-serif mt-0.5 text-2xl font-semibold leading-tight">阅读</h1>
        </div>
        <button
          type="button"
          onClick={() => setTidying((t) => !t)}
          data-testid="shelf-tidy-btn"
          className={`h-8 rounded-lg border px-3 text-xs ${
            tidying ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]' : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
          }`}
        >
          {tidying ? '完成' : '整理'}
        </button>
      </header>

      {works === null && <p className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">书架加载中…</p>}
      {works?.length === 0 && (
        <div className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">
          <p>还没有可阅读的书</p>
          <p className="mt-2 text-xs">在「创作」里给章节上架后，就会出现在这里</p>
        </div>
      )}

      {groups.map(([tag, ws]) => (
        <section key={tag} className="mb-4">
          <h2 className="m-serif mb-1.5 px-1 text-xs tracking-widest text-[hsl(var(--fg-muted))]">
            ◈ {tag} · {ws.length} 本
          </h2>
          <div className="flex flex-col gap-2">
            {ws.map((w) => (
              <div key={w.id} className="flex items-center gap-2" data-testid={`read-shelf-item-${w.id}`}>
                <Link
                  to={`/m/read/${w.id}`}
                  className="m-book-card flex min-w-0 flex-1 items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1 pl-1.5">
                    <p className="m-serif truncate text-[15px] font-medium">{w.title}</p>
                    <p className="mt-0.5 text-xs text-[hsl(var(--fg-muted))]">
                      已上架 {w.stats?.publishedChapterCount ?? 0} / {w.stats?.chapterCount ?? 0} 章
                    </p>
                  </div>
                  <span className="text-xs text-[hsl(var(--fg-muted))]">›</span>
                </Link>
                {tidying && (
                  <span className="flex shrink-0 flex-col gap-1" data-testid={`tidy-${w.id}`}>
                    <button type="button" onClick={() => move(w.id, -1)} aria-label="上移" className="h-7 w-7 rounded border border-[hsl(var(--border-soft))] text-xs">
                      ↑
                    </button>
                    <button type="button" onClick={() => move(w.id, 1)} aria-label="下移" className="h-7 w-7 rounded border border-[hsl(var(--border-soft))] text-xs">
                      ↓
                    </button>
                    {isAuthor && (
                      <button type="button" onClick={() => void setTag(w)} aria-label="改标签" className="h-7 w-7 rounded border border-[hsl(var(--border-soft))] text-xs">
                        <Tag className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
