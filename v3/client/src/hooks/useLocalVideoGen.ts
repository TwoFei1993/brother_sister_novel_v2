/**
 * 本地 ComfyUI 视频生成 hook（第四通道）：分镜帧→H3 音画一体视频→mp4 自动归档
 *
 * 通道选择：挑帧（frameIdx）→i2v 单首帧；默认 ≥2 帧→flf2v（F1 起势→F4 落势动作弧完整）。
 * 抽卡：run({trial:true}) 用 3 秒（73 帧）快速验证动作/运镜/口型，满意再出完整时长终稿（自动超分 1080p）。
 */
import { useState } from 'react';

import { uploadDuanjuVideo, duanjuFileUrl } from '../api/duanju';
import { generateVideoOnComfy, upscaleVideoOnComfy, loadComfyConfig, type VideoGenProgress } from '../features/duanju/lib/comfy';
import { buildLocalVideoPrompt } from '../features/duanju/lib/prompts/prompts-storyboard';
import { useDuanjuStore } from '../features/duanju/store';
import type { DuanjuShot } from '@shared/duanju';

export type { VideoGenProgress as LocalGenProgress } from '../features/duanju/lib/comfy';

export function useComfyAvailable(): boolean {
  const cfg = loadComfyConfig();
  // 视频工作流为空时走内置 H3 Flash 默认模板，只要求地址已配置
  return Boolean(cfg.url.trim());
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

  async function run(opts?: { trial?: boolean; frameIdx?: number }): Promise<void> {
    if (state) return;
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
    try {
      // 挑帧（frameIdx 指定帧做首帧，单帧 i2v）；未指定时 ≥2 帧自动首尾帧控制（F1 起势 → F4 落势）
      const pickIdx = opts?.frameIdx !== undefined ? opts.frameIdx : null;
      const firstPath = pickIdx !== null ? (frames[pickIdx] ?? framePath) : framePath;
      const frameBlob = firstPath ? await fetchImageBlob(workId, firstPath) : null;
      const lastFrameBlob = pickIdx === null && frames.length >= 2 ? await fetchImageBlob(workId, frames[frames.length - 1]!) : null;
      const prompt = buildLocalVideoPrompt(shot);
      const durationSec = opts?.trial ? 3 : (shot.durationSec ?? 5);
      const { blob } = await generateVideoOnComfy(
        cfg,
        frameBlob,
        prompt,
        setState,
        durationSec,
        lastFrameBlob ? { lastFrameBlob } : undefined,
      );
      // 终稿自动超分上 1080p（试跑不超分——抽卡只要快）；超分失败回退归档原片，不丢成果
      let finalBlob = blob;
      if (!opts?.trial) {
        try {
          setState({ phase: 'queued', elapsedSec: 0 });
          const up = await upscaleVideoOnComfy(cfg, blob, setState);
          finalBlob = up.blob;
        } catch {
          setError('超分 1080p 失败——已归档原分辨率版本（可重试或换档）');
        }
      }
      const suffix = opts?.trial ? '-trial' : '';
      const file = new File([finalBlob], `S${shot.index}-local${suffix}.mp4`, { type: 'video/mp4' });
      await uploadDuanjuVideo(workId, shot.id, file);
      await useDuanjuStore.getState().load(workId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '本地生成失败，请重试');
    } finally {
      setState(null);
    }
  }

  return { available: useComfyAvailable(), state, error, run, setError };
}
