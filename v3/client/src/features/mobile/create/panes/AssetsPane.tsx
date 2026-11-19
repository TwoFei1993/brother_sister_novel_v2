/**
 * 资料分区：作品设定摘要 + 分卷规划（卷管主线节奏）+ 章节大纲（章管具体剧情）。
 * 卷/章分层编辑（用户要求：卷和章节区分开且可直接使用）——两层分开保存（PATCH work.settings）。
 */
import { useState } from 'react';

import { apiFetch } from '../../../../api/client';
import { updateWork } from '../../../../api/works';
import { chapterTitle } from '../../../../lib/chapter-title';
import { volumeOfChapter } from '../../../../lib/outline/chapters';
import type { VolumeOutlineItem, Work } from '@shared/work';

export function AssetsPane({ work, nextIndex, onUpdated }: { work: Work; nextIndex: number; onUpdated: (w: Work) => void }) {
  const s = work.settings;
  const outlines = s.chapterOutlines ?? [];
  const volumes = s.volumeOutlines ?? [];
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftPlot, setDraftPlot] = useState('');
  const [saving, setSaving] = useState(false);
  // 分卷规划（卷规划层）：点条目展开编辑；全空保存 = 删除该卷
  const [volEditingIdx, setVolEditingIdx] = useState<number | null>(null);
  const [volDraft, setVolDraft] = useState<VolumeOutlineItem | null>(null);
  const [volSaving, setVolSaving] = useState(false);

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

  // ---------- 分卷规划（卷规划层，与章细纲分层——用户可直接使用） ----------

  function startVolEdit(v: VolumeOutlineItem): void {
    setVolEditingIdx(v.index);
    setVolDraft({ ...v });
  }

  function startVolAdd(): void {
    const draft: VolumeOutlineItem = {
      index: volumes.reduce((mx, v) => Math.max(mx, v.index), 0) + 1,
      title: '',
      summary: '',
    };
    setVolDraft(draft);
    setVolEditingIdx(draft.index);
  }

  /** 保存卷：title/summary 全空 = 删除该卷，否则按卷号 upsert（乐观锁 PATCH） */
  async function saveVolume(): Promise<void> {
    if (!volDraft || volSaving) return;
    setVolSaving(true);
    try {
      const empty = volDraft.title.trim() === '' && volDraft.summary.trim() === '';
      const list = (empty ? volumes.filter((v) => v.index !== volDraft.index) : [...volumes.filter((v) => v.index !== volDraft.index), volDraft])
        .map((v) => ({
          index: v.index,
          title: v.title.trim(),
          summary: v.summary.trim(),
          ...(Number.isFinite(v.startChapter) && v.startChapter ? { startChapter: Math.max(1, Math.floor(v.startChapter)) } : {}),
        }))
        .sort((a, b) => a.index - b.index);
      const latest = await apiFetch<Work>(`/api/works/${work.id}`);
      const updated = await updateWork(work.id, {
        revision: latest.revision,
        settings: { ...work.settings, volumeOutlines: list },
      });
      onUpdated(updated);
      setVolEditingIdx(null);
      setVolDraft(null);
    } catch {
      alert('分卷保存失败（可能版本冲突），请重试');
    } finally {
      setVolSaving(false);
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

      {/* ---------- 分卷规划（卷规划层，在章细纲之上） ---------- */}
      <section className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
        <h2 className="mb-2 text-sm font-semibold">分卷规划</h2>
        <p className="mb-2 text-[10px] text-[hsl(var(--fg-muted))]">
          卷管主线节奏、章管具体剧情——生成各章时自动注入所属卷的主线概述
        </p>
        {volumes.length === 0 && <p className="text-xs text-[hsl(var(--fg-muted))]">暂无分卷（可先分卷再写章，也可不分卷直接用章节大纲）</p>}
        <ol className="flex flex-col gap-1.5">
          {volumes.map((v) => {
            if (volEditingIdx === v.index && volDraft) return null; // 编辑中的卷由列表后的独立表单渲染
            return (
              <li key={v.index}>
                <button
                  type="button"
                  onClick={() => startVolEdit(v)}
                  data-testid={`volume-item-${v.index}`}
                  className="w-full rounded-lg px-3 py-2 text-left text-xs leading-5"
                >
                  <span className="font-medium">
                    第{v.index}卷《{v.title || '未命名'}</span>
                  {v.startChapter ? <span className="text-[hsl(var(--fg-muted))]"> · 第{v.startChapter}章起</span> : null}
                  <p className="mt-0.5 line-clamp-2 text-[hsl(var(--fg-muted))]">{v.summary || '（概述待补写）'}</p>
                </button>
              </li>
            );
          })}
        </ol>
        {/* 卷编辑表单（独立于列表：新增卷时 volumes 为空也必须可见——实测空列表 bug 修复） */}
        {volDraft && (
          <div className="mt-2 rounded-lg border border-[hsl(var(--accent))]/50 bg-[hsl(var(--accent))]/5 p-2.5" data-testid="volume-edit-form">
            <div className="mb-1.5 flex gap-1.5">
              <input
                type="number"
                min={1}
                value={volDraft.index}
                onChange={(e) => setVolDraft({ ...volDraft, index: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                aria-label="卷号"
                className="h-9 w-16 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none focus:border-[hsl(var(--accent))]"
              />
              <input
                value={volDraft.title}
                onChange={(e) => setVolDraft({ ...volDraft, title: e.target.value })}
                placeholder="卷名"
                aria-label="卷名"
                className="h-9 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none focus:border-[hsl(var(--accent))]"
              />
              <label className="flex items-center gap-1 text-[10px] text-[hsl(var(--fg-muted))]">
                起始章
                <input
                  type="number"
                  min={1}
                  value={volDraft.startChapter ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setVolDraft({ ...volDraft, startChapter: Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined });
                  }}
                  aria-label="本卷起始章号"
                  className="h-9 w-14 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none focus:border-[hsl(var(--accent))]"
                />
              </label>
            </div>
            <textarea
              value={volDraft.summary}
              onChange={(e) => setVolDraft({ ...volDraft, summary: e.target.value })}
              rows={3}
              placeholder="本卷主线概述：本卷起止事件与主线推进（150-300 字）"
              aria-label="本卷主线概述"
              className="w-full resize-y rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-2 text-xs leading-5 outline-none focus:border-[hsl(var(--accent))]"
            />
            <div className="mt-1.5 flex gap-2">
              <button
                type="button"
                onClick={() => void saveVolume()}
                disabled={volSaving}
                data-testid="volume-save"
                className="h-8 flex-1 rounded-lg bg-[hsl(var(--accent))] text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
              >
                {volSaving ? '保存中…' : '保存'}
              </button>
              <button
                type="button"
                onClick={() => {
                  // 删除：清空卷名与概述后保存（saveVolume 的全空=删除语义）
                  setVolDraft({ ...volDraft, title: '', summary: '' });
                }}
                disabled={volSaving}
                title="清空卷名与概述后点保存即为删除该卷"
                className="h-8 flex-1 rounded-lg border border-red-400/40 text-xs text-red-400 disabled:opacity-40"
              >
                删除
              </button>
              <button
                type="button"
                onClick={() => {
                  setVolEditingIdx(null);
                  setVolDraft(null);
                }}
                className="h-8 flex-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg-muted))]"
              >
                取消
              </button>
            </div>
          </div>
        )}
        {volDraft === null && (
          <button
            type="button"
            onClick={startVolAdd}
            data-testid="volume-add"
            className="mt-2 h-9 w-full rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
          >
            ＋ 添加卷
          </button>
        )}
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
                  {volumeOfChapter(volumes, o.index) && (
                    <span className="ml-1.5 rounded-full border border-[hsl(var(--border-soft))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--fg-muted))]">
                      {volumeOfChapter(volumes, o.index)}
                    </span>
                  )}
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
