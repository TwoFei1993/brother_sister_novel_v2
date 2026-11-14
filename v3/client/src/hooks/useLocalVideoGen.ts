/**
 * 本地 ComfyUI 视频生成 hook（第四通道）：分镜帧→H3 音画一体视频→mp4 自动归档
 *
 * 全链实现在 lib/videoProduce.ts（与整集队列共享）；本壳负责组件态 + 锁屏恢复：
 * 提交后 prompt_id 落 localStorage 槽，ComfyUI 侧独立执行不受页面影响；
 * 页面冻结/进程被杀后 mount + visibilitychange visible 双通道恢复轮询（history 幂等）。
 */
import { useEffect, useRef, useState } from 'react';

import { loadComfyConfig, type VideoGenProgress } from '../features/duanju/lib/comfy';
import {
  produceShotVideo,
  readSlot,
  clearSlot,
  finishShotTask,
} from '../features/duanju/lib/videoProduce';
import { useDuanjuStore } from '../features/duanju/store';
import type { DuanjuShot } from '@shared/duanju';

export type { VideoGenProgress as LocalGenProgress } from '../features/duanju/lib/comfy';

export function useComfyAvailable(): boolean {
  const cfg = loadComfyConfig();
  // 视频工作流为空时走内置 H3 Flash 默认模板，只要求地址已配置
  return Boolean(cfg.url.trim());
}

export function useLocalVideoGen(workId: string, shot: DuanjuShot) {
  const [state, setState] = useState<VideoGenProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 忙碌标志（run 与恢复轮询共用，防双通道并发） */
  const busyRef = useRef(false);

  /** 恢复轮询（mount / visibilitychange visible 调用）：槽里有未完成任务 → 续查归档 */
  function resumePending(): void {
    if (busyRef.current) return;
    const slot = readSlot(workId, shot.id);
    if (!slot) return;
    busyRef.current = true;
    setState({ phase: 'generating', elapsedSec: Math.round((Date.now() - slot.startedAt) / 1000) });
    void finishShotTask(workId, shot, slot, setState, (m) => setError(m))
      .catch((err) => {
        clearSlot(workId, shot.id);
        setError(err instanceof Error ? err.message : '本地生成失败，请重试');
      })
      .finally(() => {
        busyRef.current = false;
        setState(null);
      });
  }

  // 锁屏/切出固化恢复：mount 一次 + 每次回到可见时检查任务槽
  useEffect(() => {
    resumePending();
    const onVis = (): void => {
      if (document.visibilityState === 'visible') resumePending();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, shot.id]);

  async function run(opts?: { trial?: boolean; frameIdx?: number }): Promise<void> {
    if (busyRef.current || state) return;
    if (!loadComfyConfig().url.trim()) {
      setError('未配置本地引擎——请到设置页填写 ComfyUI 地址');
      return;
    }
    const frames = (shot.frames ?? []).filter((f) => f.image?.path).map((f) => f.image!.path);
    if (frames.length === 0 && !shot.gridImage) {
      setError('尚无分镜帧——先生成分镜帧，再本地生成视频');
      return;
    }
    setState({ phase: 'uploading', elapsedSec: 0 });
    setError(null);
    busyRef.current = true;
    try {
      const project = useDuanjuStore.getState().project;
      if (!project) throw new Error('项目数据未加载');
      await produceShotVideo(workId, shot, project, opts, setState, (m) => setError(m));
    } catch (err) {
      clearSlot(workId, shot.id);
      setError(err instanceof Error ? err.message : '本地生成失败，请重试');
    } finally {
      busyRef.current = false;
      setState(null);
    }
  }

  return { available: useComfyAvailable(), state, error, run, setError };
}
