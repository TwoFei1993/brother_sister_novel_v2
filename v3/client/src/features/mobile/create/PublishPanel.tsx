/**
 * 上架管理模式（安卓 app Phase1，共识 D3/D7）：全屏面板，草稿态 + 总开关保存
 *
 * - 进入时快照各章上架状态为本地草稿；所有开关/选版本只改草稿
 * - 「保存上架更改」= 逐章 PATCH（仅 diff 章节），server 顺带重算 stats.publishedChapterCount
 * - 退出未保存 → confirm 拦截；保存后阅读书架立即可见（publishedChapterCount>0 判据）
 * - 整本上架 = 未上架章一律以其当前激活版本上架（可跳章：只列已有章节）；全部下架一键反向
 */
import { useMemo, useState } from 'react';

import { patchMessage } from '../../../api/works';
import { useWorkStore } from '../../../stores/work';
import type { Message } from '@shared/message';

type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };
/** 草稿：章节消息 id → 上架版本 id（null=不上架） */
type Drafts = Record<string, string | null>;

export default function PublishPanel({
  chapters,
  onClose,
}: {
  chapters: readonly ChapterMsg[];
  onClose: () => void;
}) {
  const work = useWorkStore((s) => s.work);
  const [drafts, setDrafts] = useState<Drafts>(() =>
    Object.fromEntries(chapters.map((c) => [c.id, c.chapter.publishedVersionId ?? null])),
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** 有版本可选的章（无版本的章开关禁用，提示先去写） */
  const changeCount = useMemo(
    () =>
      chapters.filter((c) => (drafts[c.id] ?? null) !== (c.chapter.publishedVersionId ?? null)).length,
    [chapters, drafts],
  );

  function setDraft(id: string, versionId: string | null): void {
    setDrafts((d) => ({ ...d, [id]: versionId }));
  }

  function publishAll(): void {
    setDrafts(Object.fromEntries(chapters.map((c) => [c.id, c.swipes[c.swipeId]?.id ?? c.chapter.publishedVersionId ?? null])));
  }

  function unpublishAll(): void {
    setDrafts(Object.fromEntries(chapters.map((c) => [c.id, null])));
  }

  async function save(): Promise<void> {
    if (!work || saving) return;
    setSaving(true);
    try {
      for (const c of chapters) {
        const next = drafts[c.id] ?? null;
        if (next === (c.chapter.publishedVersionId ?? null)) continue;
        const updated: Message = { ...c, chapter: { ...c.chapter, publishedVersionId: next } };
        await patchMessage(work.id, updated);
        useWorkStore.getState().upsertLocal(updated);
      }
      onClose();
    } catch {
      alert('保存失败，请检查网络后重试（已保存的章节不会回退）');
    } finally {
      setSaving(false);
    }
  }

  function requestClose(): void {
    if (changeCount > 0 && !confirm(`有 ${changeCount} 处上架调整尚未保存，确定放弃并退出？`)) return;
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[hsl(var(--bg))] text-[hsl(var(--fg))]" data-testid="publish-panel">
      {/* 顶栏：返回 / 标题 / 改动计数 */}
      <header className="safe-top flex shrink-0 items-center gap-2 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2">
        <button
          type="button"
          onClick={requestClose}
          className="flex h-9 min-w-9 items-center justify-center rounded-lg text-sm"
          aria-label="退出上架管理"
        >
          ✕
        </button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">上架管理</h1>
        {changeCount > 0 && (
          <span className="rounded-full bg-[hsl(var(--accent))]/10 px-2 py-0.5 text-xs text-[hsl(var(--accent))]" data-testid="publish-dirty-count">
            {changeCount} 处改动
          </span>
        )}
      </header>

      {/* 批量操作条 */}
      <div className="flex shrink-0 gap-2 border-b border-[hsl(var(--border-soft))] px-4 py-2">
        <button
          type="button"
          onClick={publishAll}
          data-testid="publish-all-btn"
          className="h-8 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] text-xs"
        >
          整本上架（当前版本）
        </button>
        <button
          type="button"
          onClick={unpublishAll}
          data-testid="unpublish-all-btn"
          className="h-8 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] text-xs"
        >
          全部下架
        </button>
      </div>

      {/* 章节列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {chapters.length === 0 && <p className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">还没有章节可上架</p>}
        <ul className="flex flex-col gap-2">
          {chapters.map((c) => {
            const selected = drafts[c.id] ?? null;
            const original = c.chapter.publishedVersionId ?? null;
            const changed = selected !== original;
            const activeVersion = c.swipes[c.swipeId];
            return (
              <li key={c.id} className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={selected !== null}
                    disabled={c.swipes.length === 0}
                    data-testid={`publish-switch-${c.chapter.index}`}
                    onClick={() => setDraft(c.id, selected === null ? (activeVersion?.id ?? null) : null)}
                    className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-30 ${
                      selected !== null ? 'bg-[hsl(var(--accent))]' : 'bg-[hsl(var(--fg-muted))]/30'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                        selected !== null ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  >
                    <p className={`truncate text-sm ${changed ? 'font-medium text-[hsl(var(--accent))]' : ''}`}>
                      第{c.chapter.index}章 {c.chapter.title || '未命名'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[hsl(var(--fg-muted))]">
                      {selected === null
                        ? '未上架'
                        : `上架版本：${c.swipes.find((v) => v.id === selected)?.name ?? '?'}`}
                    </p>
                  </button>
                </div>

                {/* 版本选择（行内展开） */}
                {expanded === c.id && (
                  <ul className="flex flex-col gap-1 border-t border-[hsl(var(--border-soft))] px-3 py-2">
                    {c.swipes.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          data-testid={`publish-version-${v.name}`}
                          onClick={() => setDraft(c.id, v.id)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
                            selected === v.id ? 'bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]' : ''
                          }`}
                        >
                          <span className="font-medium">{v.name}</span>
                          <span className="rounded-full bg-[hsl(var(--fg-muted))]/10 px-1.5 text-[10px]">{v.origin}</span>
                          <span className="ml-auto text-[hsl(var(--fg-muted))]">{v.content.length} 字</span>
                          {selected === v.id && <span>✓</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* 总开关保存 */}
      <div className="safe-bottom shrink-0 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-4 py-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || changeCount === 0}
          data-testid="publish-save-btn"
          className="h-12 w-full rounded-xl bg-[hsl(var(--accent))] text-sm font-semibold text-[hsl(var(--accent-fg))] disabled:opacity-40"
        >
          {saving ? '保存中…' : changeCount > 0 ? `保存上架更改（${changeCount}）` : '保存上架更改'}
        </button>
        <p className="mt-1.5 text-center text-[10px] text-[hsl(var(--fg-muted))]">保存后阅读模式立即生效；不保存退出则维持上次结果</p>
      </div>
    </div>
  );
}
