/**
 * 单镜头视频全链生产（P1-5 抽取，hook 与整集队列共享）：
 * 帧图拉取 → v2 提示词（人物规格+衔接锚点）→ 提交（prompt_id 落 localStorage 槽，锁屏/切出安全）
 * → 轮询 → 终稿超分 1080p（失败回退原片）→ 归档 → 清槽 → store 刷新。
 *
 * 「只补缺失」幂等：已归档成品的镜头直接跳过——中断后再点一次即断点续跑。
 */
import { uploadDuanjuVideo, duanjuFileUrl } from '../../../api/duanju';
import {
  pollVideoOnComfy,
  submitVideoOnComfy,
  loadComfyConfig,
  optimizePromptOnComfy,
  upscaleVideoOnComfy,
  type SubmittedVideoTask,
  type VideoGenProgress,
} from './comfy';
import { buildLocalVideoPrompt } from './prompts/prompts-video';
import { pickFramePath } from './framePick';
import { useDuanjuStore } from '../store';
import type { DuanjuProject, DuanjuShot } from '@shared/duanju';

/** 任务槽（跨页面生命周期恢复的唯一事实源；hook 恢复轮询与本模块共用） */
const slotKey = (workId: string, shotId: string): string => `v3-local-video-task-${workId}-${shotId}`;

export interface VideoTaskSlot {
  base: string;
  promptId: string;
  trial: boolean;
  startedAt: number;
}

export function readSlot(workId: string, shotId: string): VideoTaskSlot | null {
  try {
    const raw = localStorage.getItem(slotKey(workId, shotId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<VideoTaskSlot>;
    if (typeof p.base !== 'string' || typeof p.promptId !== 'string') return null;
    return { base: p.base, promptId: p.promptId, trial: p.trial === true, startedAt: p.startedAt ?? Date.now() };
  } catch {
    return null;
  }
}

export function writeSlot(workId: string, shotId: string, task: SubmittedVideoTask, trial: boolean): void {
  localStorage.setItem(
    slotKey(workId, shotId),
    JSON.stringify({ base: task.base, promptId: task.promptId, trial, startedAt: task.startedAt } satisfies VideoTaskSlot),
  );
}

export function clearSlot(workId: string, shotId: string): void {
  localStorage.removeItem(slotKey(workId, shotId));
}

export async function fetchImageBlob(workId: string, path: string): Promise<Blob | null> {
  try {
    const r = await fetch(duanjuFileUrl(workId, path));
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}

/** 阶段二收尾（提交/恢复共用）：轮询 → 超分 → 归档 → 清槽；超分失败回退原片不丢成果 */
export async function finishShotTask(
  workId: string,
  shot: DuanjuShot,
  slot: VideoTaskSlot,
  onProgress: (p: VideoGenProgress) => void,
  onWarn: (m: string) => void,
): Promise<void> {
  const { blob } = await pollVideoOnComfy(slot, onProgress);
  let finalBlob = blob;
  if (!slot.trial) {
    try {
      onProgress({ phase: 'queued', elapsedSec: 0 });
      finalBlob = (await upscaleVideoOnComfy(loadComfyConfig(), blob, onProgress)).blob;
    } catch {
      onWarn('超分 1080p 失败——已归档原分辨率版本（可重试或换档）');
    }
  }
  const file = new File([finalBlob], `S${shot.index}-local${slot.trial ? '-trial' : ''}.mp4`, { type: 'video/mp4' });
  await uploadDuanjuVideo(workId, shot.id, file);
  clearSlot(workId, shot.id);
  await useDuanjuStore.getState().load(workId);
}

/** 全链生产单镜头（挑帧 frameIdx / 试跑 trial）；抛错即该镜头失败（调用方决定跳过或中止） */
export async function produceShotVideo(
  workId: string,
  shot: DuanjuShot,
  project: DuanjuProject,
  opts: { trial?: boolean; frameIdx?: number } = {},
  onProgress: (p: VideoGenProgress) => void = () => {},
  onWarn: (m: string) => void = () => {},
): Promise<void> {
  const cfg = loadComfyConfig();
  if (!cfg.url.trim()) throw new Error('未配置本地引擎——请到设置页填写 ComfyUI 地址');
  const frames = (shot.frames ?? []).filter((f) => f.image?.path).map((f) => f.image!.path);
  const framePath = frames[0] ?? shot.gridImage?.path ?? null;
  if (!framePath) throw new Error('尚无分镜帧——先生成分镜帧');
  const trial = opts.trial === true;
  const pickIdx = opts.frameIdx !== undefined ? opts.frameIdx : null;
  const firstPath = pickIdx !== null ? (pickFramePath(shot, pickIdx) ?? framePath) : framePath;
  onProgress({ phase: 'uploading', elapsedSec: 0 });
  const frameBlob = firstPath ? await fetchImageBlob(workId, firstPath) : null;
  const lastFrameBlob = pickIdx === null && frames.length >= 2 ? await fetchImageBlob(workId, frames[frames.length - 1]!) : null;
  const chars = (shot.characterIds ?? [])
    .map((cid) => project.characters.find((c) => c.id === cid))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({ name: c.name, profile: c.profile }));
  const prev = project.shots.find((s) => s.episodeId === shot.episodeId && s.index === shot.index - 1);
  let prompt = buildLocalVideoPrompt(shot, chars, { hasLastFrame: lastFrameBlob !== null, prevEndState: prev?.endState });
  const durationSec = trial ? 3 : (shot.durationSec ?? 5);
  if (cfg.promptOptimizer) {
    prompt = await optimizePromptOnComfy(cfg, prompt, { duration: durationSec, task: lastFrameBlob ? 'fl2va' : 'i2va' });
  }
  const task = await submitVideoOnComfy(cfg, frameBlob, prompt, durationSec, lastFrameBlob ? { lastFrameBlob } : undefined);
  writeSlot(workId, shot.id, task, trial);
  onProgress({ phase: 'generating', elapsedSec: 0 });
  await finishShotTask(workId, shot, { ...task, trial }, onProgress, onWarn);
}

// ---------- 整集队列（P1-5：只补缺失 + 断点续跑 + 单镜失败不阻塞） ----------

/** 待出片清单：本集内无成品（finalVideo 空）且有分镜帧的镜头——幂等，中断重跑自动跳过已完成 */
export function buildVideoTasks(shots: DuanjuShot[]): DuanjuShot[] {
  return shots
    .filter((s) => !s.finalVideo && ((s.frames?.length ?? 0) > 0 || s.gridImage))
    .sort((a, b) => a.index - b.index);
}

export interface VideoQueueResult {
  done: number;
  failed: Array<{ shot: DuanjuShot; error: string }>;
  aborted: boolean;
}

/**
 * 串行整集出片：逐镜头全链（视频+超分+归档），单镜失败记录后继续；
 * shouldStop 轮询真值可中止未开始镜头（正在跑的该镜跑完）。「只补缺失」口径天然断点续跑。
 */
export async function runVideoQueue(
  workId: string,
  project: DuanjuProject,
  shots: DuanjuShot[],
  hooks: {
    onShotStart?: (shot: DuanjuShot, i: number, total: number) => void;
    onShotDone?: (shot: DuanjuShot) => void;
    onShotFail?: (shot: DuanjuShot, error: string) => void;
    onProgress?: (p: VideoGenProgress) => void;
    onWarn?: (m: string) => void;
    shouldStop?: () => boolean;
  } = {},
): Promise<VideoQueueResult> {
  const tasks = buildVideoTasks(shots);
  const failed: Array<{ shot: DuanjuShot; error: string }> = [];
  let done = 0;
  let aborted = false;
  for (let i = 0; i < tasks.length; i += 1) {
    if (hooks.shouldStop?.()) {
      aborted = true;
      break;
    }
    const shot = tasks[i]!;
    hooks.onShotStart?.(shot, i + 1, tasks.length);
    // 每镜头取最新 shot 态（前镜归档后 store 已刷新；finalVideo 可能被用户手动补传）
    const fresh = useDuanjuStore.getState().project?.shots.find((s) => s.id === shot.id) ?? shot;
    if (fresh.finalVideo) {
      hooks.onShotDone?.(fresh); // 已有成品（用户手动传的）——跳过计完成
      done += 1;
      continue;
    }
    try {
      await produceShotVideo(workId, fresh, useDuanjuStore.getState().project ?? project, {}, hooks.onProgress, hooks.onWarn);
      done += 1;
      hooks.onShotDone?.(fresh);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败';
      clearSlot(workId, shot.id);
      failed.push({ shot, error: msg });
      hooks.onShotFail?.(shot, msg);
    }
  }
  return { done, failed, aborted };
}
