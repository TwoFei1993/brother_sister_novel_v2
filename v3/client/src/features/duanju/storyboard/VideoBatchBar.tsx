/**
 * 整集批量出片（P1-5）：只补缺失 + 断点续跑 + 单镜失败不阻塞
 *
 * 确认弹窗（待出片镜头数=无成品且有分镜帧）→ 串行执行（视频+超分+归档全链）
 * → 逐镜状态列表（可中止未开始镜头；正在跑的该镜跑完）。
 * 幂等：中断后再点一次自动跳过已完成的镜头继续（prompt_id 槽固化，切出安全）。
 */
import { useRef, useState } from 'react';
import { X } from 'lucide-react';

import { useDuanjuStore } from '../store';
import { buildVideoTasks, runVideoQueue } from '../lib/videoProduce';
import { useComfyAvailable } from '../../../hooks/useLocalVideoGen';
import type { DuanjuShot } from '@shared/duanju';

interface Props {
  workId: string;
  episodeTitle: string;
  shots: DuanjuShot[];
  onClose: () => void;
}

type ShotState = { status: 'pending' | 'running' | 'done' | 'fail'; error?: string };

export default function VideoBatchBar({ workId, episodeTitle, shots, onClose }: Props) {
  const { project } = useDuanjuStore();
  const available = useComfyAvailable();
  const [phase, setPhase] = useState<'confirm' | 'run'>('confirm');
  const [states, setStates] = useState(new Map<string, ShotState>());
  const [current, setCurrent] = useState('');
  const stopRef = useRef(false);
  const [result, setResult] = useState<{ done: number; failed: number } | null>(null);

  const tasks = buildVideoTasks(shots);

  async function start(): Promise<void> {
    if (!project) return;
    setPhase('run');
    stopRef.current = false;
    const init = new Map<string, ShotState>();
    for (const s of tasks) init.set(s.id, { status: 'pending' });
    setStates(new Map(init));
    const r = await runVideoQueue(workId, project, shots, {
      onShotStart: (s, i, total) => {
        setCurrent(`第 ${i}/${total} 镜（S${s.index}，约 ${s.durationSec ?? 5}s 片长）`);
        setStates((m) => new Map(m).set(s.id, { status: 'running' }));
      },
      onShotDone: (s) => setStates((m) => new Map(m).set(s.id, { status: 'done' })),
      onShotFail: (s, e) => setStates((m) => new Map(m).set(s.id, { status: 'fail', error: e })),
      shouldStop: () => stopRef.current,
    });
    setResult({ done: r.done, failed: r.failed.length });
  }

  const entries = tasks.map((s) => [s, states.get(s.id) ?? { status: 'pending' as const }] as const);
  const done = entries.filter(([, st]) => st.status === 'done').length;
  const failed = entries.filter(([, st]) => st.status === 'fail').length;
  const finished = result !== null;
  /** 待出片总时长（预估：镜头时长 + 超分约 1.8 倍时长） */
  const estMin = Math.round(tasks.reduce((a, s) => a + (s.durationSec ?? 5), 0) * 2.8 / 60);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden md:max-w-xl rounded-t-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] sm:rounded-2xl"
        role="dialog"
        aria-label="整集批量出片"
      >
        <div className="flex items-center justify-between border-b border-[hsl(var(--border-soft))] px-4 py-3">
          <h3 className="text-sm font-semibold">🎬 {episodeTitle} 整集出片（只补缺失）</h3>
          <button
            type="button"
            onClick={finished || phase === 'confirm' ? onClose : () => { stopRef.current = true; onClose(); }}
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[hsl(var(--bg))]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {phase === 'confirm' ? (
          <div className="flex-1 space-y-3 px-4 py-4 text-sm">
            <p>
              待出片 <strong className="text-[hsl(var(--accent))]">{tasks.length}</strong> 个镜头
              <span className="text-xs text-[hsl(var(--fg-muted))]">
                （本地免费 · 预计 {estMin > 0 ? `约 ${estMin} 分钟` : '数分钟'}——串行视频+超分+自动归档）
              </span>
            </p>
            <p className="text-xs leading-5 text-[hsl(var(--fg-muted))]">
              只补缺失：已有成品的镜头自动跳过（含你手动上传的）——中断后再点一次即断点续跑。
              单镜失败不阻塞后续；每镜 F1+F4 首尾帧、音画一体、自动超分 1080p。
              期间可切出/锁屏（任务在本地引擎侧执行，回来自动收尾）。
            </p>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="h-11 flex-1 rounded-lg border border-[hsl(var(--border-soft))] text-sm">
                取消
              </button>
              <button
                type="button"
                onClick={() => void start()}
                disabled={tasks.length === 0 || !available}
                className="h-11 flex-1 rounded-lg bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
                data-testid="video-batch-confirm"
              >
                {available ? `开跑 ${tasks.length} 镜` : '需先配置本地引擎'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <p className="mb-3 text-sm">
              进度 {done}/{tasks.length}
              {failed > 0 && <span className="text-[hsl(var(--danger))]"> · 失败 {failed}</span>}
              {!finished && current && <span className="ml-2 text-xs text-[hsl(var(--fg-muted))]">{current}</span>}
              {!finished && (
                <button type="button" onClick={() => { stopRef.current = true; }} className="ml-3 text-xs text-[hsl(var(--danger))] underline">
                  跑完当前镜后中止
                </button>
              )}
            </p>
            <ul className="space-y-1.5 text-xs">
              {entries.map(([s, st]) => (
                <li key={s.id} className="flex items-center justify-between rounded-lg border border-[hsl(var(--border-soft))] px-3 py-1.5">
                  <span>S{s.index} · {s.shotSize}{s.dialog ? ' · 有台词' : ''}</span>
                  <span
                    className={
                      st.status === 'done'
                        ? 'text-[hsl(var(--accent))]'
                        : st.status === 'fail'
                          ? 'text-[hsl(var(--danger))]'
                          : 'text-[hsl(var(--fg-muted))]'
                    }
                  >
                    {st.status === 'running'
                      ? '出片中…'
                      : st.status === 'done'
                        ? '✓'
                        : st.status === 'fail'
                          ? (st.error ?? '失败')
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
                data-testid="video-batch-done"
              >
                完成（{result!.done} 成功{result!.failed > 0 ? ` / ${result!.failed} 失败` : ''}）——去导出 tab 合成成片
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
