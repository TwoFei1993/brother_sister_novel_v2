/**
 * 流水线相关的两个模块级 store（设计共识 2026-11-26 第 3.4 / 3.6 节）——不放组件 state，
 * 分区重挂 / 页面内任何重渲染都不丢：
 *
 * - useEpisodeDraftStore：分集剧本的编辑草稿（按作品与集隔离）。AI 结果先进草稿，
 *   点「保存并采用」才落库；保存或放弃后清除。
 * - usePipelineStore：流水线运行态（按作品隔离），进度条与「运行中禁用」都订阅它。
 *   真正的防重入标志在 runner（模块级），本 store 只是对外可订阅的快照。
 */
import { create } from 'zustand';

import type { PipelineFailure, PipelineStep } from '@shared/duanju';

const draftKey = (workId: string, episodeId: string): string => `${workId}:${episodeId}`;

interface DraftState {
  drafts: Record<string, string>;
  draftOf: (workId: string, episodeId: string) => string;
  setDraft: (workId: string, episodeId: string, text: string) => void;
  clearDraft: (workId: string, episodeId: string) => void;
  /** 清除某作品的全部草稿（切书 / 删除作品） */
  clearWork: (workId: string) => void;
}

export const useEpisodeDraftStore = create<DraftState>()((set, get) => ({
  drafts: {},
  draftOf: (workId, episodeId) => get().drafts[draftKey(workId, episodeId)] ?? '',
  setDraft: (workId, episodeId, text) =>
    set((s) => ({ drafts: { ...s.drafts, [draftKey(workId, episodeId)]: text } })),
  clearDraft: (workId, episodeId) =>
    set((s) => {
      const next = { ...s.drafts };
      delete next[draftKey(workId, episodeId)];
      return { drafts: next };
    }),
  clearWork: (workId) =>
    set((s) => ({
      drafts: Object.fromEntries(Object.entries(s.drafts).filter(([k]) => !k.startsWith(`${workId}:`))),
    })),
}));

export type PipelineRunStatus = 'running' | 'stopped' | 'done' | 'failed' | 'paused';

/** 某作品的流水线运行态快照 */
export interface PipelineRun {
  status: PipelineRunStatus;
  step: PipelineStep;
  /** 正在处理的集号（逐集阶段） */
  episodeIndex: number;
  /** 给人看的当前步骤（「改编剧本·第 3 集」） */
  label: string;
  failed: PipelineFailure[];
  /** 结束时的汇总 */
  message: string;
}

interface PipelineState {
  runs: Record<string, PipelineRun>;
  runOf: (workId: string) => PipelineRun | undefined;
  setRun: (workId: string, run: PipelineRun) => void;
  clearRun: (workId: string) => void;
}

export const usePipelineStore = create<PipelineState>()((set, get) => ({
  runs: {},
  runOf: (workId) => get().runs[workId],
  setRun: (workId, run) => set((s) => ({ runs: { ...s.runs, [workId]: run } })),
  clearRun: (workId) =>
    set((s) => {
      const next = { ...s.runs };
      delete next[workId];
      return { runs: next };
    }),
}));

/** 「是否在跑」的权威判定在 runner 的模块级运行标志（isPipelineRunning）；本 store 只是对外快照 */

export const STEP_LABELS: Record<PipelineStep, string> = {
  character: '提取角色档案',
  scene: '提取场景档案',
  script: '改编剧本',
  storyboard: '拆镜头',
};
