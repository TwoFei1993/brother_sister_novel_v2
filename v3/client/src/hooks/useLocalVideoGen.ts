/**
 * 本地 ComfyUI 视频生成 hook（第四通道）：帧图→H3 图生视频→mp4 自动归档
 *
 * 从 ShotCard 抽离（行数合规 + 逻辑复用）：状态机 + 完整生成流程；
 * 引擎可用性按 localStorage 配置判定（地址+工作流齐 = 可用）。
 */
import { useState } from 'react';

import { uploadDuanjuVideo, duanjuFileUrl } from '../api/duanju';
import { generateVideoOnComfy, loadComfyConfig, type VideoGenProgress } from '../features/duanju/lib/comfy';
import { useDuanjuStore } from '../features/duanju/store';
import type { DuanjuShot } from '@shared/duanju';

export type { VideoGenProgress as LocalGenProgress } from '../features/duanju/lib/comfy';

export function useComfyAvailable(): boolean {
  const cfg = loadComfyConfig();
  return Boolean(cfg.url.trim() && cfg.workflow.trim());
}

export function useLocalVideoGen(workId: string, shot: DuanjuShot) {
  const [state, setState] = useState<VideoGenProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    if (state) return;
    const framePath = shot.frames?.[0]?.image?.path ?? shot.gridImage?.path;
    if (!framePath) {
      setError('尚无分帧图——先生成/上传分帧图，再本地生成视频');
      return;
    }
    const cfg = loadComfyConfig();
    if (!cfg.url.trim() || !cfg.workflow.trim()) {
      setError('未配置本地引擎——请到设置页填写 ComfyUI 地址与工作流');
      return;
    }
    setState({ phase: 'uploading', elapsedSec: 0 });
    setError(null);
    try {
      const frameRes = await fetch(duanjuFileUrl(workId, framePath));
      const frameBlob = await frameRes.blob();
      const frameText = shot.gridParts.length > 0 ? shot.gridParts[0] : `${shot.actionStart} → ${shot.actionEnd}`;
      const prompt = [
        frameText,
        shot.dialog ? `台词：「${shot.dialog}」` : '',
        shot.sound ? `声音：${shot.sound}` : '',
      ]
        .filter(Boolean)
        .join('。');
      const { blob } = await generateVideoOnComfy(cfg, frameBlob, prompt, setState);
      const file = new File([blob], `S${shot.index}-local.mp4`, { type: 'video/mp4' });
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
