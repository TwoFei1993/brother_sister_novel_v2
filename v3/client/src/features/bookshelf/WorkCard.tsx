/**
 * 作品封面卡：题材渐变 + 标题 + 模式/章节/时间 + 悬浮操作
 *
 * 交互移植旧站 Bookshelf（设计 §7.1"沿用现有交互"）：
 * - 点击封面 → /work/:id 续写；续写按钮同效
 * - 改名：行内编辑（Enter 保存 / Esc 取消）；浅列表无 revision，先 GET 全量再 PATCH
 * - 删除：卡内确认弹层 → DELETE
 * 触控目标全部 ≥36px（h-9）；移动端操作条常显，桌面 hover 浮现。
 */
import { useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { getWork, updateWorkTitle, deleteWork } from '../../api/works';
import type { WorkSummary } from '../../api/works';
import { ApiError } from '../../api/client';
import type { Work } from '@shared/work';
import { genreLabel, genreOption, MODE_LABELS } from './genres';

interface WorkCardProps {
  work: WorkSummary;
  /** 改名成功后回传最新 summary（父层更新列表） */
  onUpdated: (work: WorkSummary) => void;
  /** 删除成功后回调（父层移除卡片） */
  onDeleted: (id: string) => void;
}

/** 全量 Work → 书架 summary（保持字段同源，避免手工拼装漂移） */
function toSummary(work: Work): WorkSummary {
  return {
    id: work.id,
    title: work.title,
    mode: work.mode,
    genre: work.genre,
    updatedAt: work.updatedAt,
    stats: work.stats,
  };
}

function describeActionError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === 'conflict') return '版本冲突，请刷新页面后重试';
    if (err.code === 'notFound') return '作品已不存在，请刷新书架';
    return err.message;
  }
  return fallback;
}

export default function WorkCard({ work, onUpdated, onDeleted }: WorkCardProps) {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  /** Esc 取消标记：输入框随取消卸载时的 blur 不应误触发保存 */
  const renameCancelled = useRef(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gradient = genreOption(work.genre).gradient;

  function openWork(): void {
    navigate(`/work/${work.id}`);
  }

  function startRename(e: MouseEvent<HTMLButtonElement>): void {
    e.stopPropagation();
    setTitleDraft(work.title);
    renameCancelled.current = false;
    setError(null);
    setRenaming(true);
  }

  async function saveRename(): Promise<void> {
    const title = titleDraft.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const full = await getWork(work.id); // 浅列表无 revision，取全量作乐观锁基准
      const updated = await updateWorkTitle(work.id, { revision: full.revision, title });
      onUpdated(toSummary(updated));
      setRenaming(false);
    } catch (err) {
      setError(describeActionError(err, '改名失败，请重试'));
    } finally {
      setBusy(false);
    }
  }

  function onRenameKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') void saveRename();
    if (e.key === 'Escape') {
      renameCancelled.current = true;
      setRenaming(false);
    }
  }

  /** 失焦即保存（未改动则跳过）；Esc 取消不保存 */
  function onRenameBlur(): void {
    if (renameCancelled.current) return;
    if (titleDraft.trim() && titleDraft.trim() !== work.title) void saveRename();
    else setRenaming(false);
  }

  function startDelete(e: MouseEvent<HTMLButtonElement>): void {
    e.stopPropagation();
    setError(null);
    setConfirmingDelete(true);
  }

  async function confirmDelete(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteWork(work.id);
      onDeleted(work.id);
    } catch (err) {
      setError(describeActionError(err, '删除失败，请重试'));
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  const chapterCount = work.stats?.chapterCount ?? 0;

  return (
    <div className="group relative">
      {/* 封面：点击进入写作台 */}
      <button
        type="button"
        onClick={openWork}
        aria-label={`打开作品 ${work.title}`}
        className={`relative flex aspect-[2/3] w-full flex-col items-center justify-between overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br ${gradient} p-3 text-left shadow-lg transition-transform duration-200 group-hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))]`}
      >
        <span className="absolute left-0 top-0 bottom-0 w-2 bg-gradient-to-r from-black/30 to-transparent" />
        <span className="w-full text-center text-sm leading-tight font-semibold line-clamp-3 text-white/90 drop-shadow">
          {work.title}
        </span>
        <span className="text-[10px] text-white/60">{genreLabel(work.genre)}</span>
      </button>

      {/* 操作条：移动端常显（文档流，避免叠压信息区）；桌面 hover 悬浮浮现。触控目标 ≥36px */}
      <div className="mt-2 flex justify-center gap-2 sm:absolute sm:inset-x-0 sm:bottom-0 sm:translate-y-1 sm:p-1.5 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100">
        <button
          type="button"
          onClick={openWork}
          title="续写"
          aria-label={`续写 ${work.title}`}
          className="h-9 w-9 rounded-lg bg-black/60 text-base text-white/90 backdrop-blur transition-colors hover:bg-black/80"
        >
          ✍
        </button>
        <button
          type="button"
          onClick={startRename}
          title="改名"
          aria-label={`重命名 ${work.title}`}
          className="h-9 w-9 rounded-lg bg-black/60 text-base text-white/90 backdrop-blur transition-colors hover:bg-black/80"
        >
          ✎
        </button>
        <button
          type="button"
          onClick={startDelete}
          title="删除"
          aria-label={`删除 ${work.title}`}
          className="h-9 w-9 rounded-lg bg-black/60 text-base text-[hsl(var(--danger))] backdrop-blur transition-colors hover:bg-black/80"
        >
          ✕
        </button>
      </div>

      {/* 信息区：模式标签 + 章节数 + 更新时间 */}
      <div className="mt-2 space-y-0.5 text-center text-xs text-[hsl(var(--fg-muted))]">
        <p>
          <span className="mr-1 inline-block rounded bg-[hsl(var(--surface))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--fg))] ring-1 ring-[hsl(var(--border-soft))]">
            {MODE_LABELS.get(work.mode) ?? work.mode}
          </span>
          {chapterCount} 章
        </p>
        {renaming ? (
          <input
            value={titleDraft}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitleDraft(e.target.value)}
            onKeyDown={onRenameKeyDown}
            onBlur={onRenameBlur}
            autoFocus
            aria-label="作品新标题"
            disabled={busy}
            className="w-full rounded-md border border-[hsl(var(--accent))] bg-[hsl(var(--bg))] px-2 py-1.5 text-center text-sm text-[hsl(var(--fg))] outline-none"
          />
        ) : (
          <p title={new Date(work.updatedAt).toLocaleString('zh-CN')}>
            {new Date(work.updatedAt).toLocaleDateString('zh-CN')}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-1 text-center text-xs text-[hsl(var(--danger))]">
          {error}
        </p>
      )}

      {/* 删除确认弹层 */}
      {confirmingDelete && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/80 p-4 text-center backdrop-blur-sm">
          <p className="text-sm font-medium text-white/90">删除「{work.title}」？</p>
          <p className="text-xs text-white/50">章节内容将一并删除，不可恢复</p>
          <div className="mt-1 flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={busy}
              className="h-9 min-w-16 rounded-lg bg-white/15 px-4 text-sm text-white/90 transition-colors hover:bg-white/25"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={busy}
              className="h-9 min-w-16 rounded-lg bg-[hsl(var(--danger))] px-4 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? '删除中…' : '删除'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
