/**
 * 本地 ComfyUI 视频生成 hook（第四通道）：分帧图/定妆照→H3 音画一体视频→mp4 自动归档
 *
 * 通道选择（帧优先）：≥2 帧→flf2v（首尾帧，动作弧完整）；1 帧→i2v；无帧→ref2v（定妆照直出）。
 * 抽卡：run({trial:true}) 用 3 秒（73 帧）快速验证动作/运镜/口型，满意再出完整时长终稿。
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

  async function run(opts?: { trial?: boolean }): Promise<void> {
    if (state) return;
    const cfg = loadComfyConfig();
    if (!cfg.url.trim()) {
      setError('未配置本地引擎——请到设置页填写 ComfyUI 地址');
      return;
    }
    const frames = (shot.frames ?? []).filter((f) => f.image?.path).map((f) => f.image!.path);
    const framePath = frames[0] ?? shot.gridImage?.path ?? null;
    // 无分帧图时的兜底：出场角色定妆照（≤2 张）→ ref2v 直出（跨镜头角色一致性）
    const refBlobs: Blob[] = [];
    if (frames.length === 0) {
      for (const cid of shot.characterIds.slice(0, 2)) {
        const char = useDuanjuStore.getState().project?.characters.find((c) => c.id === cid);
        const ref = char?.sheetImages.find((i) => i.id === char.refImageId) ?? char?.sheetImages[0];
        const blob = ref ? await fetchImageBlob(workId, ref.path) : null;
        if (blob) refBlobs.push(blob);
      }
    }
    if (!framePath && refBlobs.length === 0) {
      setError('尚无分帧图或定妆照——先生成分帧图/设定图，再本地生成视频');
      return;
    }
    setState({ phase: 'uploading', elapsedSec: 0 });
    setError(null);
    try {
      const frameBlob = framePath ? await fetchImageBlob(workId, framePath) : null;
      // ≥2 帧自动首尾帧控制（F1 起势 → F4 落势，动作弧完整）
      const lastFrameBlob = frames.length >= 2 ? await fetchImageBlob(workId, frames[frames.length - 1]!) : null;
      const prompt = buildLocalVideoPrompt(shot);
      const durationSec = opts?.trial ? 3 : (shot.durationSec ?? 5);
      const { blob } = await generateVideoOnComfy(
        cfg,
        frameBlob,
        prompt,
        setState,
        durationSec,
        lastFrameBlob ? { lastFrameBlob } : refBlobs.length > 0 ? { refBlobs } : undefined,
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
