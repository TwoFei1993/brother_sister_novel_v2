/**
 * 剧本 tab 的单集 AI 生成（改编 / 续写 / 重写，设计共识 2026-11-26 第 3.4 节）：
 * 结果进草稿（不落库），用户点「保存并采用」才写入。
 *
 * 切出安全：任务在服务端后台跑；taskId 存 localStorage，页面被回收或刷新后回到剧本 tab
 * 自动续轮询并取回结果。同一时刻只生成一集。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DuanjuEpisode, DuanjuProject } from '@shared/duanju';

import { useSettingsStore } from '../../../../stores/settings';
import { generateEpisodeScript } from '../../lib/pipeline/episodeGen';
import { useEpisodeDraftStore } from '../../lib/pipeline/stores';
import { useDuanjuStore } from '../../store';

export type EpisodeGenKind = 'auto' | 'rewrite';

interface PendingGen {
  workId: string;
  episodeId: string;
  kind: EpisodeGenKind;
  directive?: string;
  taskId: string;
  startedAt: number;
}

/** 某一集的生成进行态 */
export interface EpisodeGenActive {
  episodeId: string;
  kind: EpisodeGenKind;
  startedAt: number;
}

export interface EpisodeGenError {
  episodeId: string;
  message: string;
}

const pendingKey = (workId: string): string => `duanju-epgen-${workId}`;

function readPending(workId: string): PendingGen | null {
  try {
    const raw = localStorage.getItem(pendingKey(workId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingGen>;
    return typeof p.episodeId === 'string' && typeof p.taskId === 'string' && typeof p.startedAt === 'number'
      ? { ...p, workId, episodeId: p.episodeId, kind: p.kind === 'rewrite' ? 'rewrite' : 'auto', taskId: p.taskId, startedAt: p.startedAt }
      : null;
  } catch {
    return null;
  }
}

const clearPending = (workId: string): void => {
  try {
    localStorage.removeItem(pendingKey(workId));
  } catch {
    /* 存储不可用：只影响切出后续取 */
  }
};

export function useEpisodeGen(workId: string) {
  const [active, setActive] = useState<EpisodeGenActive | null>(null);
  const [error, setError] = useState<EpisodeGenError | null>(null);
  const busyRef = useRef(false);

  /** 跑一次生成：结果进草稿；失败记人话错误 */
  const run = useCallback(
    async (project: DuanjuProject, episode: DuanjuEpisode, kind: EpisodeGenKind, directive: string | undefined, existingTaskId: string | undefined, startedAt: number) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setActive({ episodeId: episode.id, kind, startedAt });
      setError(null);
      try {
        const prefs = useSettingsStore.getState().llmPrefs;
        const text = await generateEpisodeScript(project, episode, prefs, {
          ...(kind === 'rewrite' ? { kind, directive } : {}),
          existingTaskId,
          onSubmitted: (taskId) => {
            try {
              localStorage.setItem(pendingKey(workId), JSON.stringify({ workId, episodeId: episode.id, kind, directive, taskId, startedAt } satisfies PendingGen));
            } catch {
              /* 存不进去：页面被回收后会丢这次结果，不阻塞当前生成 */
            }
          },
        });
        useEpisodeDraftStore.getState().setDraft(workId, episode.id, text);
      } catch (err) {
        setError({ episodeId: episode.id, message: err instanceof Error ? err.message : '生成失败，请重试' });
      } finally {
        clearPending(workId);
        busyRef.current = false;
        setActive(null);
      }
    },
    [workId],
  );

  // 回到剧本 tab / 刷新后：有没取回的任务就续轮询，结果照常进草稿
  useEffect(() => {
    const pending = readPending(workId);
    if (!pending) return;
    const project = useDuanjuStore.getState().project;
    const episode = project?.episodes.find((e) => e.id === pending.episodeId);
    if (!project || !episode) {
      clearPending(workId); // 集已不存在：任务结果没处放
      return;
    }
    void run(project, episode, pending.kind, pending.directive, pending.taskId, pending.startedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId]);

  const start = useCallback(
    (episode: DuanjuEpisode, kind: EpisodeGenKind, directive?: string): void => {
      const project = useDuanjuStore.getState().project;
      if (project) void run(project, episode, kind, directive, undefined, Date.now());
    },
    [run],
  );

  return { active, error, start, dismissError: () => setError(null) };
}
