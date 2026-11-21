/**
 * 书架批量同步生成弹窗（Chunk 6 Task 6.1）：多选书逐本提交 novel-chapter 后台任务
 *
 * - 表单：每本书章数（1-10 默认 1）+ 并发数（1-4 默认 2；server 全局并发编排器目前走
 *   env NOVEL_GEN_PARALLEL，字段前向预留随 body 透传）
 * - 提交：逐本 POST /api/llm/tasks（顺序发起）；409 GEN_BUSY 的书跳过并计数不中断；
 *   全部完成后展示汇总（「已发起 X 本，Y 本跳过…」）并自动关闭
 * - prefs 取 useSettingsStore.llmPrefs 非敏感字段全量（与 useNovelTask 同款映射 taskPrefsOf，
 *   含 repetitionPenalty）；样式对齐 NewWorkDialog 遮罩+卡片结构
 */
import { useState, type FormEvent } from 'react';

import type { WorkSummary } from '../../api/works';
import { ApiError } from '../../api/client';
import { novelTaskSlotKey } from '../../hooks/useNovelTask';
import { submitNovelChapter, taskPrefsOf } from '../../lib/llmTask';
import { useSettingsStore } from '../../stores/settings';

interface BatchGenerateDialogProps {
  works: WorkSummary[];
  onClose: () => void;
}

/** 章数上限（弹窗语义「补更几章」，远小于单任务硬上限 50） */
const CHAPTERS_MAX = 10;
const PARALLEL_MAX = 4;
/** 汇总展示时长：到时自动关闭（「知道了」可立即关） */
const SUMMARY_AUTO_CLOSE_MS = 2200;

function clampInt(v: number, max: number): number {
  return Math.max(1, Math.min(max, Number.isFinite(v) ? Math.trunc(v) : 1));
}

export default function BatchGenerateDialog({ works, onClose }: BatchGenerateDialogProps) {
  const [chapters, setChapters] = useState(1);
  const [parallel, setParallel] = useState(2);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<{ submitted: number; skipped: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting || works.length === 0) return;
    setSubmitting(true);
    setError(null);
    const prefs = taskPrefsOf(useSettingsStore.getState().llmPrefs);
    let submitted = 0;
    let skipped = 0;
    let failed = 0;
    for (const w of works) {
      try {
        const taskId = await submitNovelChapter({
          kind: 'novel-chapter',
          workId: w.id,
          prefs,
          mode: 'chapter',
          directive: '',
          chapters,
          outline: false,
          parallel,
        });
        // 书页恢复锚点（缝①）：useNovelTask mount 恢复只认 novel-gen-${workId}——
        // 批量发起的书打开书页才能认领轮询、看到回流与停止入口（与书页提交同款）
        try {
          localStorage.setItem(novelTaskSlotKey(w.id), taskId);
        } catch {
          /* 隐私模式静默——仅影响刷新恢复 */
        }
        submitted += 1;
      } catch (err) {
        // 409 GEN_BUSY：该书已有任务进行中 → 跳过计数，不中断其余书
        if (err instanceof ApiError && err.status === 409) skipped += 1;
        else failed += 1;
      }
    }
    setSubmitting(false);
    setSummary({ submitted, skipped, failed });
    setTimeout(onClose, SUMMARY_AUTO_CLOSE_MS);
  }

  const inputCls =
    'h-11 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm text-[hsl(var(--fg))] outline-none focus:border-[hsl(var(--accent))]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={submitting ? undefined : onClose}
      role="presentation"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        role="dialog"
        aria-modal="true"
        aria-label="批量同步生成"
        data-testid="batch-generate-dialog"
        onClick={(e) => e.stopPropagation()}
        className="safe-bottom max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-6 shadow-2xl"
      >
        <h2 className="mb-1.5 text-lg font-semibold">批量同步生成</h2>
        <p className="mb-4 text-xs text-[hsl(var(--fg-muted))]">
          为所选 {works.length} 本小说各发起 {chapters} 章后台任务——切出页面后 server 继续生成，卡片徽标实时显示进度
        </p>

        {/* 所选书目 */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {works.map((w) => (
            <span
              key={w.id}
              className="max-w-full truncate rounded-md bg-[hsl(var(--bg))] px-2 py-1 text-xs text-[hsl(var(--fg))] ring-1 ring-[hsl(var(--border-soft))]"
            >
              {w.title}
            </span>
          ))}
        </div>

        {summary ? (
          <div
            data-testid="batch-summary"
            className="mb-4 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-4 py-3 text-sm"
          >
            <p>
              已发起 {summary.submitted} 本
              {summary.skipped > 0 ? `，${summary.skipped} 本跳过（已有任务进行中）` : ''}
            </p>
            {summary.failed > 0 && (
              <p className="mt-1 text-[hsl(var(--danger))]">{summary.failed} 本提交失败（网络异常，可重试）</p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-3 h-10 w-full rounded-lg bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity hover:opacity-90"
            >
              知道了
            </button>
          </div>
        ) : (
          <>
            {/* 每本书章数 */}
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm text-[hsl(var(--fg-muted))]">每本书章数（1-10）</span>
              <input
                type="number"
                min={1}
                max={CHAPTERS_MAX}
                value={chapters}
                onChange={(e) => setChapters(clampInt(Number(e.target.value), CHAPTERS_MAX))}
                data-testid="batch-chapters-input"
                aria-label="每本书生成章数"
                className={inputCls}
              />
            </label>

            {/* 并发数 */}
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm text-[hsl(var(--fg-muted))]">并发数（1-4）</span>
              <input
                type="number"
                min={1}
                max={PARALLEL_MAX}
                value={parallel}
                onChange={(e) => setParallel(clampInt(Number(e.target.value), PARALLEL_MAX))}
                data-testid="batch-parallel-input"
                aria-label="同时生成的任务数"
                className={inputCls}
              />
              <span className="mt-1 block text-xs text-[hsl(var(--fg-muted))]">
                多本书同时在后台排队生成，server 默认并发 2 超出排队的部分依次等待
              </span>
            </label>

            {error && (
              <p role="alert" className="mb-3 text-sm text-[hsl(var(--danger))]">
                {error}
              </p>
            )}
          </>
        )}

        {!summary && (
          <div className="flex justify-end gap-3">
            <button
              type="button"
              data-testid="batch-cancel"
              onClick={onClose}
              disabled={submitting}
              className="h-11 rounded-lg px-5 text-sm text-[hsl(var(--fg-muted))] transition-colors hover:text-[hsl(var(--fg))] disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="batch-submit"
              disabled={submitting || works.length === 0}
              className="h-11 rounded-lg bg-[hsl(var(--accent))] px-6 text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity disabled:opacity-40"
            >
              {submitting ? '发起中…' : `开始生成（${works.length} 本）`}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
