/**
 * 整集批量出图（共识 D6：预估确认 + 排队 + 逐镜头状态；烧钱操作不自动跑）
 *
 * 两段式：①确认弹窗（张数=待生成镜头数，每张约 0.2 元提示）②执行面板
 * （ImageQueue 并发 2；单镜头失败不阻塞；可中止未开始任务）。
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { useDuanjuStore } from '../store';
import { ImageQueue, type TaskState } from '../lib/imageQueue';
import type { DuanjuShot } from '@shared/duanju';

interface Props {
  workId: string;
  episodeTitle: string;
  shots: DuanjuShot[];
  onClose: () => void;
}

export default function BatchBar({ workId, episodeTitle, shots, onClose }: Props) {
  const load = useDuanjuStore((s) => s.load);
  const [queue] = useState(() => new ImageQueue());
  const [phase, setPhase] = useState<'confirm' | 'run'>('confirm');
  const [states, setStates] = useState(new Map<string, TaskState>());

  useEffect(() => {
    queue.setOnProject(() => void load(workId));
    return queue.subscribe((s) => setStates(new Map(s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingShots = shots.filter((s) => !s.gridImage && s.gridPrompt.trim());

  function start(): void {
    setPhase('run');
    queue.enqueue(
      workId,
      pendingShots.map((s) => ({
        input: { kind: 'shot' as const, refId: s.id, prompt: s.gridPrompt, aspectRatio: '1:1' },
        label: `镜头 ${s.index}`,
      })),
    );
  }

  const entries = [...states.entries()];
  const done = entries.filter(([, s]) => s.status === 'done').length;
  const failed = entries.filter(([, s]) => s.status === 'fail').length;
  const total = entries.length;
  const finished = total > 0 && done + failed >= total;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden md:max-w-xl rounded-t-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] sm:rounded-2xl"
        role="dialog"
        aria-label="整集批量出图"
      >
        <div className="flex items-center justify-between border-b border-[hsl(var(--border-soft))] px-4 py-3">
          <h3 className="text-sm font-semibold">⚡ {episodeTitle} 批量出图</h3>
          <button
            type="button"
            onClick={finished || phase === 'confirm' ? onClose : () => queue.abort()}
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg))]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {phase === 'confirm' ? (
          <div className="flex-1 space-y-3 px-4 py-4 text-sm">
            <p>
              将生成 <strong className="text-[hsl(var(--accent))]">{pendingShots.length}</strong> 张四宫格
              <span className="text-xs text-[hsl(var(--fg-muted))]">（每张约 0.2 元 · 15-30 秒，并发 2 逐张排队）</span>
            </p>
            <p className="text-xs text-[hsl(var(--fg-muted))]">
              已有图或无 prompt 的镜头跳过；生成中可随时中止未开始的任务；单张失败不阻塞后续。
            </p>
            {shots.some((s) => !s.gridPrompt.trim()) && (
              <p className="text-xs text-[hsl(var(--danger))]">
                有 {shots.filter((s) => !s.gridPrompt.trim()).length} 个镜头缺 prompt（跳过）——可先「AI 拆镜头」补齐。
              </p>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="h-11 flex-1 rounded-lg border border-[hsl(var(--border-soft))] text-sm">
                取消
              </button>
              <button
                type="button"
                onClick={start}
                disabled={pendingShots.length === 0}
                className="h-11 flex-1 rounded-lg bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
                data-testid="batch-confirm"
              >
                确认生成 {pendingShots.length} 张
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <p className="mb-3 text-sm">
              进度 {done}/{total}
              {failed > 0 && <span className="text-[hsl(var(--danger))]"> · 失败 {failed}</span>}
              {!finished && (
                <button type="button" onClick={() => queue.abort()} className="ml-3 text-xs text-[hsl(var(--danger))] underline">
                  中止剩余
                </button>
              )}
            </p>
            <ul className="space-y-1.5 text-xs">
              {entries.map(([id, s]) => (
                <li key={id} className="flex items-center justify-between rounded-lg border border-[hsl(var(--border-soft))] px-3 py-1.5">
                  <span>{s.label}</span>
                  <span
                    className={
                      s.status === 'done'
                        ? 'text-[hsl(var(--accent))]'
                        : s.status === 'fail'
                          ? 'text-[hsl(var(--danger))]'
                          : 'text-[hsl(var(--fg-muted))]'
                    }
                  >
                    {s.status === 'running'
                      ? '生成中…'
                      : s.status === 'done'
                        ? '✓'
                        : s.status === 'fail'
                          ? (s.error ?? '失败')
                          : s.status === 'aborted'
                            ? '已中止'
                            : '排队中'}
                  </span>
                </li>
              ))}
            </ul>
            {finished && (
              <button
                type="button"
                onClick={onClose}
                className="mt-4 h-11 w-full rounded-lg bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))]"
              >
                完成（{done} 成功 / {failed} 失败）
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
