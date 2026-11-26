/**
 * 流水线进度条（设计共识 2026-11-26 第 3.6 节）：由工作台渲染在顶栏下方——切到别的分区也看得到、停得了。
 *
 * - 运行中：当前步骤 + 集进度 + 停止
 * - 停靠：提示 + 继续拆镜头 / 不继续了
 * - 中断：原因 + 重试（有断点才能续；启动就失败时只给「知道了」）
 * - 停止 / 完成但有失败：汇总 + 知道了（全部完成且无失败时不显示）
 */
import { useMemo } from 'react';

import { continuePipeline, dismissPausedPipeline, resumePipeline, stopPipeline } from '../lib/pipeline/runner';
import { readCheckpoint } from '../lib/pipeline/checkpoint';
import { usePipelineStore } from '../lib/pipeline/stores';

const btn = 'min-h-8 shrink-0 rounded-lg px-2.5 text-xs transition-colors disabled:opacity-40';

export default function PipelineStatusBar({ workId }: { workId: string }) {
  const run = usePipelineStore((s) => s.runs[workId]);

  const body = useMemo(() => {
    if (!run) return null;
    if (run.status === 'running') {
      return (
        <span className="min-w-0 flex-1 truncate" data-testid="pipeline-label">
          ⚡ 自动流水线：{run.message && run.message.startsWith('正在停止') ? run.message : run.label || '启动中…'}
          <span className="ml-1 text-[hsl(var(--fg-muted))]">——可切出，回来接着跑</span>
        </span>
      );
    }
    if (run.status === 'paused') {
      // 文案独占一行、按钮换行到下一行：窄屏下标题与说明都不被挤成半截
      return (
        <span className="min-w-0 basis-full" data-testid="pipeline-paused">
          <span className="block text-xs">⏸ {run.message}</span>
          <span className="block text-[11px] leading-4 text-[hsl(var(--fg-muted))]">审完分集剧本后再继续；想改某集，到剧本 tab 展开那一集修改。</span>
        </span>
      );
    }
    return (
      <span className="min-w-0 basis-full text-xs leading-5" data-testid={`pipeline-${run.status}`} role="status">
        {run.status === 'failed' ? `⚠️ ${run.message}` : run.message}
      </span>
    );
  }, [run]);

  if (!run || !body) return null;
  // 全部完成且没有失败：不打扰
  if (run.status === 'done' && run.failed.length === 0) return null;
  const hasCheckpoint = run.status === 'failed' && readCheckpoint(workId) !== null;

  const tone =
    run.status === 'failed'
      ? 'border-[hsl(var(--danger))]/40 bg-[hsl(var(--danger))]/10'
      : run.status === 'paused'
        ? 'border-amber-500/40 bg-amber-500/10'
        : 'border-[hsl(var(--accent))]/40 bg-[hsl(var(--accent))]/[0.07]';

  return (
    <div className={`flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs ${tone}`} data-testid="pipeline-status-bar">
      {body}
      {run.status === 'running' && (
        <button type="button" className={`${btn} border border-[hsl(var(--danger))]/60 text-[hsl(var(--danger))`} onClick={() => stopPipeline(workId)} data-testid="pipeline-stop">
          停止
        </button>
      )}
      {run.status === 'paused' && (
        <>
          <button
            type="button"
            className={`${btn} bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]`}
            onClick={() => void continuePipeline(workId)}
            data-testid="pipeline-continue"
          >
            继续拆镜头
          </button>
          <button type="button" className={`${btn} border border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]`} onClick={() => dismissPausedPipeline(workId)} data-testid="pipeline-dismiss">
            不继续了
          </button>
        </>
      )}
      {/* 有断点才能续：启动就失败（没选模型 / 读不到作品）时没有断点，「重试」会是空操作，只给「知道了」 */}
      {run.status === 'failed' && hasCheckpoint && (
        <button
          type="button"
          className={`${btn} bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]`}
          onClick={() => void resumePipeline(workId)}
          data-testid="pipeline-retry"
        >
          重试
        </button>
      )}
      {(run.status === 'stopped' || run.status === 'done' || run.status === 'failed') && (
        <button
          type="button"
          className={`${btn} border border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]`}
          onClick={() => usePipelineStore.getState().clearRun(workId)}
          data-testid="pipeline-dismiss"
        >
          知道了
        </button>
      )}
    </div>
  );
}
