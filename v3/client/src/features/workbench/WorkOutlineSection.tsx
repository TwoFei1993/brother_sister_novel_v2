/**
 * 章节大纲编辑区（作品设置抽屉子区，反馈⑦拆分自 WorkSettingsSheet）
 *
 * - 完整可编辑列表：每章 = 章号 + 标题 input + 剧情 textarea（3 行起）+ 删除章按钮，
 *   外层 max-h + overflow-y-auto 滚动（此前只露一小截，长大纲不可维护）
 * - 添加章：追加「现有最大章号+1」的空章；保存时按章号升序、剔出全空章
 * - 保存大纲：PATCH settings.chapterOutlines（乐观锁 revision），成功回传新 Work 同步 store
 * - 导入：粘贴/Word 导入 → 解析 ≥3 章 → 整体覆盖保存（与手动编辑互补，原路径保留）
 */
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { updateWork } from '../../api/works';
import { parseChapterOutlines, toChapterOutlineItems } from '../../lib/outline/chapters';
import type { ChapterOutlineItem, Work } from '@shared/work';
import DocImport from '../misc/wizard/DocImport';

interface WorkOutlineSectionProps {
  work: Work;
  /** 保存成功（父级同步 workStore.setWork） */
  onSaved: (work: Work) => void;
}

/** 章号输入兜底：非法值回退原值，最小 1（防存出 0/负数章号） */
function clampIndex(value: string, fallback: number): number {
  return Math.max(1, Math.floor(Number(value) || fallback));
}

export default function WorkOutlineSection({ work, onSaved }: WorkOutlineSectionProps) {
  const [items, setItems] = useState<ChapterOutlineItem[]>(work.settings.chapterOutlines ?? []);
  // 导入路径（保留）：粘贴/Word 文本 → 解析 → 整体覆盖
  const [outlineText, setOutlineText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // work.settings.chapterOutlines 变化（导入成功/绑定编辑等 PATCH 回传）→ 本地编辑副本同步
  useEffect(() => {
    setItems(work.settings.chapterOutlines ?? []);
  }, [work.settings.chapterOutlines]);

  const update = (i: number, patch: Partial<ChapterOutlineItem>): void =>
    setItems((prev) => prev.map((it, k) => (k === i ? { ...it, ...patch } : it)));

  const removeAt = (i: number): void => setItems((prev) => prev.filter((_, k) => k !== i));

  const addChapter = (): void =>
    setItems((prev) => [
      ...prev,
      { index: prev.reduce((mx, it) => Math.max(mx, it.index), 0) + 1, title: '', plot: '' },
    ]);

  /** 保存大纲：章号升序 + 剔出全空章 + 章号兜底 → PATCH（乐观锁） */
  async function saveOutlines(): Promise<void> {
    setBusy(true);
    setMsg('');
    const cleaned = items
      .map((it) => ({
        index: clampIndex(String(it.index), it.index),
        title: it.title.trim(),
        plot: it.plot.trim(),
      }))
      .filter((it) => it.title !== '' || it.plot !== '')
      .sort((a, b) => a.index - b.index);
    try {
      const next = await updateWork(work.id, {
        revision: work.revision,
        settings: { ...work.settings, chapterOutlines: cleaned },
      });
      setMsg(`已保存 ${cleaned.length} 章大纲，生成对应章节时自动跟随其要点`);
      onSaved(next);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  /** 导入：识别 <3 章提示；成功整体覆盖保存并回传新 Work */
  async function importOutlines(): Promise<void> {
    const chapters = parseChapterOutlines(outlineText);
    if (chapters.length < 3) {
      setMsg('未识别到章节大纲（需 ≥3 处「第N章」结构）');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const next = await updateWork(work.id, {
        revision: work.revision,
        settings: { ...work.settings, chapterOutlines: toChapterOutlineItems(chapters) },
      });
      setOutlineText('');
      setMsg(`已导入 ${chapters.length} 章大纲，生成对应章节时自动跟随其要点`);
      onSaved(next);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  const fieldCls =
    'rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] text-sm outline-none focus:border-[hsl(var(--accent))]';

  return (
    <section className="border-t border-[hsl(var(--border-soft))] pt-4">
      <p className="mb-1 text-sm font-medium">章节大纲</p>
      <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]">
        {items.length > 0
          ? `共 ${items.length} 章大纲——生成对应章节时自动跟随其剧情要点（可逐章编辑）`
          : '粘贴/导入或手动添加章节大纲，生成对应章节时自动跟随其剧情要点'}
      </p>

      {items.length > 0 && (
        <div
          data-testid="outline-list"
          className="mb-2 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-[hsl(var(--border-soft))] p-2"
        >
          {items.map((it, i) => (
            <div key={i} className="rounded-lg bg-[hsl(var(--bg))] p-2" data-testid={`outline-row-${i}`}>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={it.index}
                  onChange={(e) => update(i, { index: clampIndex(e.target.value, it.index) })}
                  aria-label={`第 ${i + 1} 项章号`}
                  data-testid={`outline-index-${i}`}
                  className={`h-8 w-16 shrink-0 px-2 ${fieldCls}`}
                />
                <input
                  value={it.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder="章节标题"
                  aria-label="章节标题"
                  data-testid={`outline-title-${i}`}
                  className={`h-8 min-w-0 flex-1 px-2 ${fieldCls}`}
                />
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  aria-label={`删除第 ${it.index} 章大纲`}
                  data-testid={`outline-remove-${i}`}
                  title="删除本章大纲"
                  className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg border border-red-400/40 px-1 text-sm text-red-400 hover:bg-red-400/10"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <textarea
                value={it.plot}
                onChange={(e) => update(i, { plot: e.target.value })}
                rows={3}
                placeholder="剧情要点"
                aria-label="剧情要点"
                data-testid={`outline-plot-${i}`}
                className={`mt-1 w-full resize-y p-2 leading-5 ${fieldCls}`}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addChapter}
          data-testid="outline-add"
          className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
        >
          ＋ 添加章
        </button>
        <button
          type="button"
          onClick={() => void saveOutlines()}
          disabled={busy}
          data-testid="outline-save"
          className="min-h-[36px] rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? '保存中…' : '保存大纲'}
        </button>
      </div>

      {/* 导入子区（保留）：粘贴/Word → 解析并保存（整体覆盖） */}
      <textarea
        aria-label="章节大纲文本"
        data-testid="chapter-outline-text"
        value={outlineText}
        onChange={(e) => setOutlineText(e.target.value)}
        rows={4}
        placeholder={'整体覆盖导入：\n第1章 落地嫡长，方寸藏天机\n剧情：女主胎穿…\n第2章 …'}
        className={`mt-3 w-full p-3 ${fieldCls}`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void importOutlines()}
          disabled={!outlineText.trim() || busy}
          data-testid="chapter-outline-import"
          className="min-h-[36px] rounded-lg border border-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent))] disabled:opacity-40"
        >
          {busy ? '解析中…' : '解析并保存'}
        </button>
        <DocImport hasContent={outlineText.trim() !== ''} onText={setOutlineText} />
      </div>
      {msg && (
        <p data-testid="chapter-outline-msg" className="mt-2 text-xs text-[hsl(var(--fg-muted))]">
          {msg}
        </p>
      )}
    </section>
  );
}
