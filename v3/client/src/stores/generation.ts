/**
 * 生成域 store（设计 §7.2 generationStore / §9.2 生成事务性）
 *
 * 流式内容仅前端暂存（半成品不入库）：刷新/关页即弃。
 * 状态机（per-work 槽位，2026-11-21 M2 Chunk 4 多槽化——多本书可并发生成互不干扰）：
 *   start(workId) → appendChunk×N → finish(workId)（入库前 buffer 保留）
 *                             ↘ fail(workId)（error 置位；error=null 表示用户主动停止）
 * partialKept=true 表示界面保留已生成部分，「继续」可用（以续写指令重组上下文再发起）。
 * 同书防重入 = 槽位级：slots[workId].streaming（novel/chat 共用同一套语义）。
 */
import { create } from 'zustand';

/** 生成错误（server LlmError code 或客户端 network/aborted/unknown） */
export interface GenerationError {
  code: string;
  message: string;
}

/** 单本书的生成槽位（旧全局单槽字段全部收进槽内；taskId 为 novel-chapter 后台任务 id） */
export interface GenSlot {
  /** 生成中 */
  streaming: boolean;
  /** 流式缓冲（含「继续」场景的半成品基底） */
  buffer: string;
  /** 思考流缓冲（D4：server thinking 帧累积；finalize 优先写入 extra.rawThinking） */
  thinkingBuffer: string;
  /** 本次生成的目标消息 id（前端预生成 uuid，入库幂等键） */
  targetMessageId: string | null;
  /** 失败错误；用户主动停止为 null */
  error: GenerationError | null;
  /** 上游结束原因（帧 raw 提取：'length'/'max_tokens'=输出被截断；截断自动续写的决定性信号） */
  finishReason: string | null;
  /** 断流/停止后已产出部分保留在界面，可「继续」 */
  partialKept: boolean;
  /** 进行中的 server 后台任务 id（novel-chapter 提交后写入：取消/恢复轮询/断点续拿） */
  taskId?: string;
}

const EMPTY_SLOT: GenSlot = {
  streaming: false,
  buffer: '',
  thinkingBuffer: '',
  targetMessageId: null,
  error: null,
  finishReason: null,
  partialKept: false,
};

/** 槽内变更（槽不存在时 no-op：孤儿 append/fail 不产生半初始化脏槽，防幽灵 streaming UI） */
function withSlot(slots: Record<string, GenSlot>, workId: string, patch: Partial<GenSlot>): Record<string, GenSlot> {
  if (!slots[workId]) return slots;
  return { ...slots, [workId]: { ...slots[workId], ...patch } };
}

export interface GenerationState {
  /** per-work 槽位表（key=work.id；遍历派生「后台生成中 N 本」/「其他书生成中」） */
  slots: Record<string, GenSlot>;
  /** 开始一次生成（写 slots[workId] 全新槽）；initialBuffer 供「继续」场景作基底 */
  start: (workId: string, targetMessageId: string, initialBuffer?: string) => void;
  appendChunk: (workId: string, text: string) => void;
  /** 记录上游结束原因（finish_reason/stop_reason 提取后写入） */
  setFinishReason: (workId: string, reason: string) => void;
  /** 思考流增量累积（不走打字机——折叠块不需要逐字动画） */
  appendThinking: (workId: string, text: string) => void;
  /** 正常完成（buffer 保留，入库成功后由调用方 reset） */
  finish: (workId: string) => void;
  /** 失败或停止（error=null 表示停止） */
  fail: (workId: string, error: GenerationError | null, partialKept: boolean) => void;
  /** 用户关闭错误提示（保留半成品供继续） */
  clearError: (workId: string) => void;
  /** 记录/清除该书的后台任务 id（novel-chapter 提交后写入） */
  setTaskId: (workId: string, taskId: string | undefined) => void;
  reset: (workId: string) => void;
}

export const useGenerationStore = create<GenerationState>()((set) => ({
  slots: {},
  start: (workId, targetMessageId, initialBuffer = '') =>
    set((s) => ({
      slots: {
        ...s.slots,
        [workId]: { ...EMPTY_SLOT, streaming: true, buffer: initialBuffer, targetMessageId },
      },
    })),
  appendChunk: (workId, text) =>
    set((s) => ({ slots: withSlot(s.slots, workId, { buffer: (s.slots[workId]?.buffer ?? '') + text }) })),
  setFinishReason: (workId, reason) => set((s) => ({ slots: withSlot(s.slots, workId, { finishReason: reason }) })),
  appendThinking: (workId, text) =>
    set((s) => ({ slots: withSlot(s.slots, workId, { thinkingBuffer: (s.slots[workId]?.thinkingBuffer ?? '') + text }) })),
  finish: (workId) => set((s) => ({ slots: withSlot(s.slots, workId, { streaming: false }) })),
  // fail 允许在槽缺失时创建（守卫前置 fail：SWIPE_LIMIT / LLM_NOMODEL——错误必须可见，
  // 与旧全局单槽「fail 于 virgin 态」行为等价）
  fail: (workId, error, partialKept) =>
    set((s) => {
      const base = s.slots[workId] ?? EMPTY_SLOT;
      return { slots: { ...s.slots, [workId]: { ...base, streaming: false, error, partialKept } } };
    }),
  clearError: (workId) => set((s) => ({ slots: withSlot(s.slots, workId, { error: null }) })),
  setTaskId: (workId, taskId) =>
    set((s) => {
      const slot = s.slots[workId];
      if (!slot) return {}; // 槽不存在 no-op（与 withSlot 同守卫）
      const next = { ...slot, taskId };
      if (taskId === undefined) delete next.taskId;
      return { slots: { ...s.slots, [workId]: next } };
    }),
  // reset 清生成现场但保留 finishReason：它是「上次输出的结束原因」（结果元数据），
  // 调用方（useGenerate 截断自动续写）在 finalize 内部 reset 之后才读取；start() 时复位
  reset: (workId) =>
    set((s) => {
      const slots = { ...s.slots };
      const prev = slots[workId];
      slots[workId] = { ...EMPTY_SLOT, finishReason: prev?.finishReason ?? null };
      return { slots };
    }),
}));

// ---------- 选择器（UI 订阅面） ----------

/** 当前书槽位（workId=null/undefined → undefined：路由未就绪时不订阅任何槽） */
export const useGenSlot = (workId: string | null | undefined): GenSlot | undefined =>
  useGenerationStore((s) => (workId ? s.slots[workId] : undefined));

/** 全量槽位（遍历派生「后台生成中 N 本」/「其他书生成中」） */
export const useGenSlots = (): Record<string, GenSlot> => useGenerationStore((s) => s.slots);

/** 任一 streaming 槽的 workId（兼容旧全局 streamingWorkId 语义：书架标出「正在写哪本」） */
export const selectStreamingWorkId = (s: GenerationState): string | null =>
  Object.keys(s.slots).find((k) => s.slots[k].streaming) ?? null;

/** 非 hook 场景读槽（事件回调/测试断言用；等价 getState().slots[workId]） */
export const getGenSlot = (workId: string): GenSlot | undefined => useGenerationStore.getState().slots[workId];
