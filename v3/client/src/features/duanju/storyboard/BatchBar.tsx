/**
 * 整集批量出图（共识 D6 → 成本优化：帧级任务）
 *
 * 两段式：①确认弹窗（帧数=待补帧总数，每张约 0.12 元；说明分帧修补只花 1/4）
 * ②执行面板（ImageQueue 并发 2；单帧失败不阻塞；可中止未开始任务）。
 * 待生成口径：分帧镜头补缺帧；旧整图镜头（有 gridImage 无 frames）跳过；
 * 空镜头（无任何图）按 4 帧全生成。
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { useDuanjuStore } from '../store';
import { useSettingsStore } from '../../../stores/settings';
import { ImageQueue, type TaskState } from '../lib/imageQueue';
import { buildFrameTasks } from '../lib/cost/frameGrid';
import { imageProviderForApi } from '../../../api/duanju';
import type { DuanjuShot } from '@shared/duanju';

interface Props {
  workId: string;
  episodeTitle: string;
  shots: DuanjuShot[];
  onClose: () => void;
}

export default function BatchBar({ workId, episodeTitle, shots, onClose }: Props) {
  const { project, load } = useDuanjuStore();
  const [queue] = useState(() => new ImageQueue());
  const [phase, setPhase] = useState<'confirm' | 'run'>('confirm');
  const [states, setStates] = useState(new Map<string, TaskState>());

  useEffect(() => {
    queue.setOnProject(() => void load(workId));
    return queue.subscribe((s) => setStates(new Map(s)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 帧级任务清单：镜头 × 缺失帧（旧整图完成态跳过） */
  const tasks = project ? buildFrameTasks(shots, project) : [];

  function start(): void {
    setPhase('run');
    queue.enqueue(
      workId,
      buildFrameTasks(shots, project!, imageProviderForApi()),
    );
  }

  const entries = [...states.entries()];
  const done = entries.filter(([, s]) => s.status === 'done').length;
  const failed = entries.filter(([, s]) => s.status === 'fail').length;
  const aborted = entries.filter(([, s]) => s.status === 'aborted').length;
  const total = entries.length;
  // P1 修复：aborted 计入完成——否则中止后 finished 永假，X 与完成按钮都失效，全屏遮罩锁死
  const finished = total > 0 && done + failed + aborted >= total;
  /** 费用/耗时文案随通道：本地 ComfyUI 免费，云端按 0.12 元/张估算 */
  const isComfy = (useSettingsStore.getState().llmPrefs.imageProvider ?? 'comfy') === 'comfy';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden md:max-w-xl rounded-t-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] sm:rounded-2xl"
        role="dialog"
        aria-label="整集批量出图"
      >
        <div className="flex items-center justify-between border-b border-[hsl(var(--border-soft))] px-4 py-3">
          <h3 className="text-sm font-semibold">⚡ {episodeTitle} 批量出图（分帧）</h3>
          <button
            type="button"
            onClick={finished || phase === 'confirm' ? onClose : () => { queue.abort(); onClose(); }}
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg))]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {phase === 'confirm' ? (
          <div className="flex-1 space-y-3 px-4 py-4 text-sm">
            <p>
              将生成 <strong className="text-[hsl(var(--accent))]">{tasks.length}</strong> 帧
              <span className="text-xs text-[hsl(var(--fg-muted))]">
                {isComfy
                  ? '（本地免费 · 秒级出图，并发 2 排队）'
                  : `（每张约 0.12 元 · 15-30 秒，并发 2 排队；约 ${(tasks.length * 0.12).toFixed(0)} 元）`}
              </span>
            </p>
            <p className="text-xs leading-5 text-[hsl(var(--fg-muted))]">
              分帧模式：某帧不满意只重roll 该帧（1/4 成本），其余帧保留。
              已出图镜头跳过；生成中可中止；单帧失败不阻塞后续。
            </p>
            {shots.some((s) => s.gridImage && (s.frames?.length ?? 0) === 0) && (
              <p className="text-xs text-[hsl(var(--fg-muted))]">
                有 {shots.filter((s) => s.gridImage && (s.frames?.length ?? 0) === 0).length}{' '}
                个旧整图镜头跳过（如需分帧，到镜头卡点「补帧」）。
              </p>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="h-11 flex-1 rounded-lg border border-[hsl(var(--border-soft))] text-sm">
                取消
              </button>
              <button
                type="button"
                onClick={start}
                disabled={tasks.length === 0}
                className="h-11 flex-1 rounded-lg bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
                data-testid="batch-confirm"
              >
                确认生成 {tasks.length} 帧
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
