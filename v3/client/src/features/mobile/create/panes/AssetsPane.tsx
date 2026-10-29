/**
 * 资料分区：作品设定摘要 + 章节大纲（可点击改写标题/要点，PATCH work.settings）。
 */
import { useState } from 'react';

import { apiFetch } from '../../../../api/client';
import { updateWork } from '../../../../api/works';
import { chapterTitle } from '../../../../lib/chapter-title';
import type { Work } from '@shared/work';

export function AssetsPane({ work, nextIndex, onUpdated }: { work: Work; nextIndex: number; onUpdated: (w: Work) => void }) {
  const s = work.settings;
  const outlines = s.chapterOutlines ?? [];
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftPlot, setDraftPlot] = useState('');
  const [saving, setSaving] = useState(false);

  function startEdit(o: { index: number; title: string; plot: string }): void {
    setEditingIdx(o.index);
    setDraftTitle(o.title);
    setDraftPlot(o.plot);
  }

  /** 保存改写：settings 整体替换（乐观锁），失败提示重试 */
  async function saveOutline(index: number): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      const nextOutlines = outlines.map((o) =>
        o.index === index ? { ...o, title: draftTitle.trim() || o.title, plot: draftPlot } : o,
      );
      const latest = await apiFetch<Work>(`/api/works/${work.id}`);
      const updated = await updateWork(work.id, {
        revision: latest.revision,
        settings: { ...work.settings, chapterOutlines: nextOutlines },
      });
      onUpdated(updated);
      setEditingIdx(null);
    } catch {
      alert('大纲保存失败（可能版本冲突），请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <section className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
        <h2 className="mb-2 text-sm font-semibold">作品设定</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs leading-5">
          <dt className="text-[hsl(var(--fg-muted))]">题材</dt>
          <dd>{s.subGenre || s.genre}</dd>
          <dt className="text-[hsl(var(--fg-muted))]">核心矛盾</dt>
          <dd className="whitespace-pre-wrap">{s.coreConflict || '—'}</dd>
          <dt className="text-[hsl(var(--fg-muted))]">力量体系</dt>
          <dd className="whitespace-pre-wrap">{s.powerSystem || '—'}</dd>
          <dt className="text-[hsl(var(--fg-muted))]">基调</dt>
          <dd>{s.storyTones.join(' / ') || '—'}</dd>
        </dl>
      </section>

      <section className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
        <h2 className="mb-2 text-sm font-semibold">章节大纲</h2>
        <p className="mb-2 text-[10px] text-[hsl(var(--fg-muted))]">点条目可改写标题与剧情要点（改写后按大纲写以此为准）</p>
        {outlines.length === 0 && (
          <p className="text-xs text-[hsl(var(--fg-muted))]">暂无章节大纲（可在桌面版一键导入或对话大纲生成）</p>
        )}
        <ol className="flex flex-col gap-1.5">
          {outlines.map((o) => {
            const active = o.index === nextIndex;
            if (editingIdx === o.index) {
              return (
                <li key={o.index} className="rounded-lg border border-[hsl(var(--accent))]/50 bg-[hsl(var(--accent))]/5 p-2.5" data-testid={`outline-edit-${o.index}`}>
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    aria-label={`第${o.index}章标题`}
                    className="mb-1.5 h-9 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none focus:border-[hsl(var(--accent))]"
                  />
                  <textarea
                    value={draftPlot}
                    onChange={(e) => setDraftPlot(e.target.value)}
                    rows={4}
                    aria-label={`第${o.index}章剧情要点`}
                    className="w-full resize-y rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-2 text-xs leading-5 outline-none focus:border-[hsl(var(--accent))]"
                  />
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void saveOutline(o.index)}
                      disabled={saving}
                      data-testid={`outline-save-${o.index}`}
                      className="h-8 flex-1 rounded-lg bg-[hsl(var(--accent))] text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
                    >
                      {saving ? '保存中…' : '保存'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingIdx(null)}
                      className="h-8 flex-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg-muted))]"
                    >
                      取消
                    </button>
                  </div>
                </li>
              );
            }
            return (
              <li key={o.index}>
                <button
                  type="button"
                  onClick={() => startEdit(o)}
                  data-testid={`outline-item-${o.index}`}
                  className={`w-full rounded-lg px-3 py-2 text-left text-xs leading-5 ${
                    active ? 'border border-[hsl(var(--accent))]/50 bg-[hsl(var(--accent))]/10' : ''
                  }`}
                >
                  <span className={active ? 'font-medium text-[hsl(var(--accent))]' : 'font-medium'}>
                    {chapterTitle(o.index, o.title)}
                  </span>
                  {active && <span className="ml-1.5 text-[10px] text-[hsl(var(--accent))]">← 下一章</span>}
                  <p className="mt-0.5 text-[hsl(var(--fg-muted))]">{o.plot}</p>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
