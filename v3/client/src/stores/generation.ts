/**
 * 生成域 store（设计 §7.2 generationStore / §9.2 生成事务性）
 *
 * 流式内容仅前端暂存（半成品不入库）：刷新/关页即弃。
 * 状态机：start → appendChunk×N → finish（入库前 buffer 保留）
 *                              ↘ fail（error 置位；error=null 表示用户主动停止）
 * partialKept=true 表示界面保留已生成部分，「继续」可用（以续写指令重组上下文再发起）。
 */
import { create } from 'zustand';

/** 生成错误（server LlmError code 或客户端 network/aborted/unknown） */
export interface GenerationError {
  code: string;
  message: string;
}

interface GenerationState {
  /** 生成中 */
  streaming: boolean;
  /** 流式缓冲（含「继续」场景的半成品基底） */
  buffer: string;
  /** 本次生成的目标消息 id（前端预生成 uuid，入库幂等键） */
  targetMessageId: string | null;
  workId: string | null;
  /** 失败错误；用户主动停止为 null */
  error: GenerationError | null;
  /** 断流/停止后已产出部分保留在界面，可「继续」 */
  partialKept: boolean;
  /** 开始一次生成；initialBuffer 供「继续」场景作基底 */
  start: (workId: string, targetMessageId: string, initialBuffer?: string) => void;
  appendChunk: (text: string) => void;
  /** 正常完成（buffer 保留，入库成功后由调用方 reset） */
  finish: () => void;
  /** 失败或停止（error=null 表示停止） */
  fail: (error: GenerationError | null, partialKept: boolean) => void;
  /** 用户关闭错误提示（保留半成品供继续） */
  clearError: () => void;
  reset: () => void;
}

const INITIAL = {
  streaming: false,
  buffer: '',
  targetMessageId: null,
  workId: null,
  error: null,
  partialKept: false,
};

export const useGenerationStore = create<GenerationState>()((set) => ({
  ...INITIAL,
  start: (workId, targetMessageId, initialBuffer = '') =>
    set({ ...INITIAL, streaming: true, buffer: initialBuffer, workId, targetMessageId }),
  appendChunk: (text) => set((s) => ({ buffer: s.buffer + text })),
  finish: () => set({ streaming: false }),
  fail: (error, partialKept) => set({ streaming: false, error, partialKept }),
  clearError: () => set({ error: null }),
  reset: () => set({ ...INITIAL }),
}));
