/**
 * 本地 ComfyUI 视频生成 hook（第四通道）：分镜帧→H3 音画一体视频→mp4 自动归档
 *
 * 通道选择：挑帧（frameIdx）→i2v 单首帧；默认 ≥2 帧→flf2v（F1 起势→F4 落势动作弧完整）。
 * 抽卡：run({trial:true}) 用 3 秒（73 帧）快速验证动作/运镜/口型，满意再出完整时长终稿（自动超分 1080p）。
 *
 * 手机长任务固化（锁屏/切出安全）：提交后 prompt_id 写 localStorage 槽，
 * ComfyUI 侧独立执行不受页面影响；页面冻结/进程被杀后，mount +
 * visibilitychange visible 双通道恢复轮询（history 幂等，结果不丢），归档后清槽。
 */
import { useEffect, useRef, useState } from 'react';

import { uploadDuanjuVideo, duanjuFileUrl } from '../api/duanju';
import {
  pollVideoOnComfy,
  submitVideoOnComfy,
  loadComfyConfig,
  optimizePromptOnComfy,
  upscaleVideoOnComfy,
  type SubmittedVideoTask,
  type VideoGenProgress,
} from '../features/duanju/lib/comfy';
import { buildLocalVideoPrompt } from '../features/duanju/lib/prompts/prompts-video';
import { pickFramePath } from '../features/duanju/lib/framePick';
import { useDuanjuStore } from '../features/duanju/store';
import type { DuanjuShot } from '@shared/duanju';

export type { VideoGenProgress as LocalGenProgress } from '../features/duanju/lib/comfy';

export function useComfyAvailable(): boolean {
  const cfg = loadComfyConfig();
  // 视频工作流为空时走内置 H3 Flash 默认模板，只要求地址已配置
  return Boolean(cfg.url.trim());
}

/** 任务槽（跨页面生命周期恢复的唯一事实源） */
const slotKey = (workId: string, shotId: string): string => `v3-local-video-task-${workId}-${shotId}`;

interface VideoTaskSlot {
  base: string;
  promptId: string;
  trial: boolean;
  startedAt: number;
}

function readSlot(workId: string, shotId: string): VideoTaskSlot | null {
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

function writeSlot(workId: string, shotId: string, task: SubmittedVideoTask, trial: boolean): void {
  localStorage.setItem(
    slotKey(workId, shotId),
    JSON.stringify({ base: task.base, promptId: task.promptId, trial, startedAt: task.startedAt } satisfies VideoTaskSlot),
  );
}

function clearSlot(workId: string, shotId: string): void {
  localStorage.removeItem(slotKey(workId, shotId));
}

async function fetchImageBlob(workId: string, path: string): Promise<Blob | null> {
  try {
    const r = await fetch(duanjuFileUrl(workId, path));
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}

export function useLocalVideoGen(workId: string, shot: DuanjuShot) {
  const [state, setState] = useState<VideoGenProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 忙碌标志（run 与恢复轮询共用，防双通道并发） */
  const busyRef = useRef(false);

  /**
   * 阶段二收尾（提交与恢复共用）：轮询取片 → 终稿超分 → 归档 → 清槽。
   * 超分失败回退归档原片（不丢成果）；结束统一清槽复位。
   */
  async function finishTask(slot: VideoTaskSlot, setErrorFn: (m: string) => void): Promise<void> {
    try {
      setState({ phase: 'generating', elapsedSec: Math.round((Date.now() - slot.startedAt) / 1000) });
      const { blob } = await pollVideoOnComfy(slot, setState);
      let finalBlob = blob;
      if (!slot.trial) {
        try {
          setState({ phase: 'queued', elapsedSec: 0 });
          const cfg = loadComfyConfig();
          const up = await upscaleVideoOnComfy(cfg, blob, setState);
          finalBlob = up.blob;
        } catch {
          setErrorFn('超分 1080p 失败——已归档原分辨率版本（可重试或换档）');
        }
      }
      const suffix = slot.trial ? '-trial' : '';
      const file = new File([finalBlob], `S${shot.index}-local${suffix}.mp4`, { type: 'video/mp4' });
      await uploadDuanjuVideo(workId, shot.id, file);
      // P2 修复：上传成功立即清槽再 load——load 期间组件重挂时 resumePending 不再读到残留槽二次上传
      clearSlot(workId, shot.id);
      await useDuanjuStore.getState().load(workId);
    } catch (err) {
      clearSlot(workId, shot.id);
      setErrorFn(err instanceof Error ? err.message : '本地生成失败，请重试');
      setState(null);
      busyRef.current = false;
      return;
    }
    clearSlot(workId, shot.id);
    setState(null);
    busyRef.current = false;
  }

  /** 恢复轮询（mount / visibilitychange visible 调用）：槽里有未完成任务 → 续查归档 */
  function resumePending(setErrorFn: (m: string) => void): void {
    if (busyRef.current) return;
    const slot = readSlot(workId, shot.id);
    if (!slot) return;
    busyRef.current = true;
    setState({ phase: 'generating', elapsedSec: Math.round((Date.now() - slot.startedAt) / 1000) });
    void finishTask(slot, setErrorFn);
  }

  // 锁屏/切出固化恢复：mount 一次 + 每次回到可见时检查任务槽
  useEffect(() => {
    const onErr = (m: string): void => setError(m);
    resumePending(onErr);
    const onVis = (): void => {
      if (document.visibilityState === 'visible') resumePending(onErr);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, shot.id]);

  async function run(opts?: { trial?: boolean; frameIdx?: number }): Promise<void> {
    if (busyRef.current || state) return;
    const cfg = loadComfyConfig();
    if (!cfg.url.trim()) {
      setError('未配置本地引擎——请到设置页填写 ComfyUI 地址');
      return;
    }
    const frames = (shot.frames ?? []).filter((f) => f.image?.path).map((f) => f.image!.path);
    const framePath = frames[0] ?? shot.gridImage?.path ?? null;
    if (!framePath) {
      setError('尚无分镜帧——先生成分镜帧，再本地生成视频');
      return;
    }
    setState({ phase: 'uploading', elapsedSec: 0 });
    setError(null);
    busyRef.current = true;
    const trial = opts?.trial === true;
    try {
      // 挑帧（frameIdx=帧号-1，指定帧做首帧，单帧 i2v）；未指定时 ≥2 帧自动首尾帧控制（F1 起势 → F4 落势）
      // 帧不全时按下标取会错位（F1/F3/F4 有图时 idx2=F4），必须按帧号查
      const pickIdx = opts?.frameIdx !== undefined ? opts.frameIdx : null;
      const firstPath = pickIdx !== null ? (pickFramePath(shot, pickIdx) ?? framePath) : framePath;
      const frameBlob = firstPath ? await fetchImageBlob(workId, firstPath) : null;
      const lastFrameBlob = pickIdx === null && frames.length >= 2 ? await fetchImageBlob(workId, frames[frames.length - 1]!) : null;
      // v2 提示词：出场角色档案（人物规格交叉验证）+ 尾帧模式声明 + 上一镜段末状态（跨镜衔接）
      const project = useDuanjuStore.getState().project;
      const chars = (shot.characterIds ?? [])
        .map((cid) => project?.characters.find((c) => c.id === cid))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({ name: c.name, profile: c.profile }));
      const prev = project?.shots.find((s) => s.episodeId === shot.episodeId && s.index === shot.index - 1);
      let prompt = buildLocalVideoPrompt(shot, chars, {
        hasLastFrame: lastFrameBlob !== null,
        prevEndState: prev?.endState,
      });
      const durationSec = trial ? 3 : (shot.durationSec ?? 5);
      // C1：AICG3D 提示词优化器（设置页开启后生效；失败静默回退模板版）
      if (cfg.promptOptimizer) {
        prompt = await optimizePromptOnComfy(cfg, prompt, {
          duration: durationSec,
          task: lastFrameBlob ? 'fl2va' : 'i2va',
        });
      }
      // 阶段一：提交——prompt_id 固化进 localStorage，锁屏/杀进程不丢（ComfyUI 侧继续执行）
      const task = await submitVideoOnComfy(
        cfg,
        frameBlob,
        prompt,
        durationSec,
        lastFrameBlob ? { lastFrameBlob } : undefined,
      );
      writeSlot(workId, shot.id, task, trial);
      setState({ phase: 'generating', elapsedSec: 0 });
      // 阶段二：轮询+超分+归档（页面冻结后由恢复通道接管）
      await finishTask({ ...task, trial }, (m) => setError(m));
    } catch (err) {
      clearSlot(workId, shot.id);
      busyRef.current = false;
      setState(null);
      setError(err instanceof Error ? err.message : '本地生成失败，请重试');
    }
  }

  return { available: useComfyAvailable(), state, error, run, setError };
}
