/**
 * 拆解后的自动流水线（设计共识 2026-11-26 第 3.6 节）：角色 → 场景 → 分集剧本（逐集）→ 拆镜头（逐集）。
 * 步骤实现见 steps.ts；这里只有运行标志、主循环与对外 API。
 *
 * - 防重入：模块级 active 表（按作品）是权威，界面快照在 usePipelineStore
 * - 单集失败不中断（记进失败清单，结束时汇总）；步骤级失败则中断并保留断点，可续跑
 * - 停止：当前这一步跑完后停下，删除断点（之后不会自动续跑）
 * - 被动中断（页面回收 / 刷新）：断点留在 localStorage，下次打开作品从断点续跑；
 *   断点里的在途任务先查状态再决定复用还是重提
 * - 停靠：剧本写完先停下等审（断点标 paused，不自动续跑），点继续后从拆镜头接着跑
 */
import type { PipelineCheckpoint, PipelineFailure, PipelineStep } from '@shared/duanju';

import { useSettingsStore } from '../../../../stores/settings';
import { clearCheckpoint, readCheckpoint, writeCheckpoint } from './checkpoint';
import { readProject, save, setRun, storyboardStep, extractStep, scriptStep, type RunCtx } from './steps';
import { usePipelineStore } from './stores';

// ---------- 运行标志（防重入的权威） ----------

/** 运行中的作品 → 这次运行的上下文（读作品期间先放 null 占位，读完再换成上下文） */
const active = new Map<string, RunCtx | null>();
/** 占位期间收到的停止请求：上下文建好后立即生效 */
const pendingStop = new Set<string>();

export function isPipelineRunning(workId: string): boolean {
  return active.has(workId);
}

export interface PipelineOutcome {
  status: 'done' | 'stopped' | 'failed' | 'paused';
  failed: PipelineFailure[];
}

export interface StartOptions {
  /** 从哪一步开始（缺省从头：角色） */
  fromStep?: PipelineStep;
  /** 只写剧本：剧本阶段跑完即停，不进入拆镜头（剧本 tab 的「一键改编全部未写集」） */
  onlyScript?: boolean;
}

/** 失败清单的汇总文案 */
export function summarizeFailures(failed: readonly PipelineFailure[]): string {
  if (failed.length === 0) return '全部完成';
  const items = failed.map((f) => `${f.step === 'script' ? '剧本' : '镜头'}·第 ${f.index} 集（${f.reason}）`);
  return `其余已完成；${failed.length} 项失败：${items.join('、')}——可在剧本 / 分镜 tab 手动重试`;
}

const PAUSED_MESSAGE = '剧本已写完——审完后点「继续拆镜头」';
const STOPPED_MESSAGE = '已停止——已完成的部分保留';

// ---------- 主循环 ----------

async function runFrom(workId: string, cp: PipelineCheckpoint, opts: StartOptions): Promise<PipelineOutcome> {
  if (active.has(workId)) return { status: 'failed', failed: cp.failed };
  active.set(workId, null); // 先同步占位再读作品：读的过程中不会被重复启动
  /** 只写剧本：启动时带的，或被动中断前留在断点里的——续跑照旧，不能写完剧本就接着拆镜头 */
  const onlyScript = opts.onlyScript === true || cp.onlyScript === true;
  let ctx: RunCtx;
  const finish = (status: 'done' | 'stopped'): PipelineOutcome => {
    clearCheckpoint(workId); // 跑完或主动停止：断点作废
    setRun(workId, { status, message: status === 'done' ? summarizeFailures(cp.failed) : STOPPED_MESSAGE });
    return { status, failed: cp.failed };
  };
  try {
    const prefs = useSettingsStore.getState().llmPrefs;
    if (!prefs.model) throw new Error('请先在设置页选择模型');
    // 直接标在这个断点对象上：ctx.cp 就是它，游标与失败清单都在它上面累积（复制一份会让停靠与收尾读到过期数据）
    if (onlyScript) cp.onlyScript = true;
    ctx = {
      workId,
      cp,
      prefs: { source: prefs.source, model: prefs.model },
      project: await readProject(workId),
      stop: pendingStop.has(workId),
    };
    active.set(workId, ctx);
    setRun(workId, { status: 'running', step: cp.step, failed: cp.failed, message: '' });
    if (ctx.stop) return finish('stopped');
    save(ctx, {});

    // 每一步跑完都先看停止请求：不再往下发任务，也不再把断点写回去（否则关页后下次会自己续跑）
    if (cp.step === 'character') {
      await extractStep(ctx, 'character');
      if (ctx.stop) return finish('stopped');
      save(ctx, { step: 'scene', taskId: undefined });
    }
    if (cp.step === 'scene') {
      await extractStep(ctx, 'scene');
      if (ctx.stop) return finish('stopped');
      save(ctx, { step: 'script', cursor: 1, taskId: undefined });
    }
    if (cp.step === 'script') {
      if ((await scriptStep(ctx)) === 'stop') return finish('stopped');
      if (onlyScript) return finish('done');
      save(ctx, { step: 'storyboard', cursor: 1, taskId: undefined });
      if (ctx.project.pipeline?.pauseAfterScripts) {
        writeCheckpoint({ ...cp, paused: true }); // 停靠：断点保留，不自动续跑
        setRun(workId, { status: 'paused', message: PAUSED_MESSAGE });
        return { status: 'paused', failed: cp.failed };
      }
    }
    if (cp.step === 'storyboard' && (await storyboardStep(ctx)) === 'stop') return finish('stopped');
    return finish('done');
  } catch (err) {
    // 步骤级失败（读作品 / 提交任务 / 保存 / 提取无结果）：有断点的保留断点，可续跑
    const message = err instanceof Error ? err.message : '流水线中断';
    const resumable = active.get(workId) !== null && readCheckpoint(workId) !== null;
    setRun(workId, {
      status: 'failed',
      message: `流水线中断：${message}${resumable ? '——已完成的步骤已保留，可重试' : '——请排除原因后重新发起'}`,
    });
    return { status: 'failed', failed: cp.failed };
  } finally {
    active.delete(workId);
    pendingStop.delete(workId);
  }
}

// ---------- 对外 API ----------

/** 启动流水线（已在运行则不重复启动，返回 null） */
export async function startPipeline(workId: string, opts: StartOptions = {}): Promise<PipelineOutcome | null> {
  if (active.has(workId)) return null;
  const cp: PipelineCheckpoint = { workId, step: opts.fromStep ?? 'character', cursor: 1, failed: [], updatedAt: Date.now() };
  if (opts.onlyScript) cp.onlyScript = true;
  return runFrom(workId, cp, opts);
}

/**
 * 请求停止：当前这一步跑完后停下并删除断点（之后不会自动续跑）。
 * 停靠中 / 没在跑时点停止 = 清掉残留的断点与提示。
 */
export function stopPipeline(workId: string): void {
  clearCheckpoint(workId);
  const ctx = active.get(workId);
  if (ctx) {
    ctx.stop = true;
    setRun(workId, { message: '正在停止——当前这一步跑完后停下' });
  } else if (active.has(workId)) {
    pendingStop.add(workId); // 还在读作品：上下文建好后立即停
  } else {
    usePipelineStore.getState().clearRun(workId);
  }
}

/** 打开作品时调用：有未完成的断点就接着跑；停靠中的只恢复提示、不自动续 */
export async function resumePipeline(workId: string): Promise<PipelineOutcome | null> {
  if (active.has(workId)) return null;
  const cp = readCheckpoint(workId);
  if (!cp) return null;
  if (cp.paused) {
    setRun(workId, { status: 'paused', step: cp.step, failed: cp.failed, message: PAUSED_MESSAGE });
    return null;
  }
  return runFrom(workId, cp, {});
}

/** 停靠后继续：从断点接着跑（通常是拆镜头阶段） */
export async function continuePipeline(workId: string): Promise<PipelineOutcome | null> {
  if (active.has(workId)) return null;
  const cp = readCheckpoint(workId);
  if (!cp || !cp.paused) return null;
  return runFrom(workId, { ...cp, paused: undefined, updatedAt: Date.now() }, {});
}

/** 停靠后决定不再继续：清除断点与提示 */
export function dismissPausedPipeline(workId: string): void {
  clearCheckpoint(workId);
  usePipelineStore.getState().clearRun(workId);
}
