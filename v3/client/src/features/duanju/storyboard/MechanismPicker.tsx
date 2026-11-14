/**
 * T8 叙事机制选择器（#6）：284 条社区实测叙事机制（反转钩/人物旅程/微表情…），
 * 每集选 ≤2 条作叙事锚——拆镜头时注入系统提示词（节拍感落实到镜头序列）。
 * 数据 public/duanju-mechanisms.json（extract-mechanisms.mjs 生成；CC BY 4.0 引用式使用）。
 */
import { useEffect, useMemo, useState } from 'react';

import type { DuanjuEpisode } from '@shared/duanju';

interface Mechanism {
  id: string;
  title: string;
  summary: string;
}

/** 模块级缓存（跨集切换不重拉） */
let cached: Mechanism[] | null = null;

interface Props {
  episode: DuanjuEpisode;
  onPick: (ids: string[]) => void;
}

export default function MechanismPicker({ episode, onPick }: Props) {
  const [all, setAll] = useState<Mechanism[]>(cached ?? []);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (cached) return;
    void fetch('/duanju-mechanisms.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { items?: Mechanism[] } | null) => {
        if (j?.items) {
          cached = j.items;
          setAll(j.items);
        }
      })
      .catch(() => {});
  }, []);

  const selected = useMemo(
    () => (episode.mechanisms ?? []).map((id) => all.find((m) => m.id === id)).filter((m): m is Mechanism => !!m),
    [episode.mechanisms, all],
  );
  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return all.slice(0, 40);
    return all.filter((m) => m.title.includes(q) || m.summary.includes(q) || m.id.includes(q)).slice(0, 40);
  }, [all, query]);

  const toggle = (id: string): void => {
    const cur = episode.mechanisms ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2); // ≤2 锚
    onPick(next);
  };

  return (
    <details className="w-full">
      <summary className="cursor-pointer text-xs text-[hsl(var(--fg-muted))]">
        叙事机制锚{selected.length > 0 ? `（${selected.map((m) => m.title).join(' ＋ ')}）` : '（可选：为拆镜头选 1-2 个节拍机制）'}
      </summary>
      <div className="mt-1.5">
        {selected.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {selected.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                title={m.summary}
                className="rounded-full bg-[hsl(var(--accent))]/15 px-2.5 py-1 text-[11px] text-[hsl(var(--accent))]"
                data-testid="mechanism-chip-selected"
              >
                {m.title} ✕
              </button>
            ))}
          </div>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜机制：反转 / 微表情 / 追逐 / 旅程…"
          className="h-8 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2.5 text-xs outline-none focus:border-[hsl(var(--accent))]"
          aria-label="搜索叙事机制"
        />
        <div className="mt-1.5 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggle(m.id)}
              title={m.summary}
              className="rounded-full border border-[hsl(var(--border-soft))] px-2.5 py-1 text-[11px] text-[hsl(var(--fg-muted))] hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))]"
            >
              {m.title}
            </button>
          ))}
          {all.length === 0 && <span className="text-[11px] text-[hsl(var(--fg-muted))]">机制库加载中（duanju-mechanisms.json）…</span>}
        </div>
      </div>
    </details>
  );
}
