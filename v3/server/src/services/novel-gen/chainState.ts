/**
 * novel-gen 章节编排的共享状态与类型（叶子模块：被 chapterChain / finalize / orchestrate
 * 共同引用，自身只依赖 shared 纯函数——消除服务内循环依赖）。
 *
 * ChainState 是 client 各 store（generation/work/settings）的 server 等价物：
 * buffer → chapterText、finishReason → finish、llmPrefs → prefs、work/messages 快照直持。
 */
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';
import { META_ONLY_PLACEHOLDER } from '@shared/engine/prompt/postprocess';
import { isCollapsedText } from '@shared/engine/prompt/novel/collapse-detect';
import type { SegmentInfo } from '@shared/engine/prompt/novel/requirements';

import type { NovelGenPrefs } from './assemble';

/** 执行期增量进度（novel-chapter runner 节流落盘的负载；routes/llm/tasks.ts TaskFile.progress 同形） */
export interface TaskProgress {
  chapterIndex: number; // 当前章（任务内序，1 起）
  chapterTotal: number; // 任务总章数
  phase: 'assembling' | 'generating' | 'continuing' | 'polishing' | 'saving';
  text: string; // 当前章累计正文（换章重置）
  done: number; // 已完成章数
  updatedAt: number;
}

/** 任务级链状态（orchestrate 构造；单章链与续写轮共享读写） */
export interface ChainState {
  workId: string;
  prefs: NovelGenPrefs;
  /** 当前 work 快照（批次屏障重读磁盘刷新） */
  work: Work;
  /** 当前上下文消息（章完成 append；屏障重读磁盘刷新） */
  messages: Message[];
  /** 全局变量快照（buildMacroEnv 的 global getVar；任务开始读一次 config.json） */
  globals: Record<string, unknown>;
  isCancelled: () => boolean;
  onProgress: (p: TaskProgress) => void;
  /** 任务内章序（1 起）与任务总章数（进度上报） */
  chapterIndex: number;
  chapterTotal: number;
  /** 已完成章数 */
  done: number;
  /** 最近一轮 LLM 结束原因（looksTruncated 判据；client 读 store，server 无 store） */
  finish: string | null;
  /** 当前章累计正文（进度 text 与拼接基底；换章重置——client store buffer 等价物） */
  chapterText: string;
  /** 末次上游错误（章失败 reason 素材） */
  lastError: string;
}

/** 进度事件构造（phase + 当前链状态快照；换章 text 重置由调用方管理 chapterText） */
export function progressOf(st: ChainState, phase: TaskProgress['phase'], text = st.chapterText): TaskProgress {
  return {
    chapterIndex: st.chapterIndex,
    chapterTotal: st.chapterTotal,
    phase,
    text,
    done: st.done,
    updatedAt: Date.now(),
  };
}

/** 单次生成的编排参数（client RunOptions 同构） */
export interface RunOpts {
  targetId: string;
  /** buffer 种子（续写轮/append：旧文进本轮聚合基底，finalize 收「旧文+新文」） */
  initialBuffer?: string;
  /** 重试等场景：只替换提示词尾的指令文本（wire）；入库 directive 仍用干净原指令 */
  promptDirective?: string;
  /** 无效输出重试：携带首次消息 id，落库行按 messageId 幂等覆盖 */
  persistMessageId?: string;
  /** 输出预算倍率（meta/崩溃重试：预算不变的重试注定再失败） */
  maxTokensScale?: number;
  /** 续写轮：要求块与输出守卫切「无缝续写」变体 */
  continuation?: boolean;
  /** 扩写轮：要求块切「扩写本章」变体（扩写轮实测关思考防 meta 空产出） */
  expandChapter?: boolean;
  thinkingOff?: boolean;
  /** 分段生成：进 tail 要求块（分段字数/停笔纪律），末段收束本章 */
  segment?: SegmentInfo;
  /** 覆盖输出预算（分段轮：只给本段的量 → finish=length 提前停，后续段自动续写） */
  effMaxTokensOverride?: number;
  /** 续写轮剩余字数（与 client 一致进 RunOpts；client 现 tail 未接线，server 复刻同现状） */
  continueRemaining?: number;
  /** 章节 title 兜底（续写轮沿用原章标题） */
  keepTitle?: string;
  /** swipe/append/expand：候选 append 进该消息（同 id 幂等覆盖） */
  swipeTarget?: Message | null;
}

/** 无效输出判定（client invalidReasonOf 同构）：仅 finalize 成功返回的消息参与判定 */
export function invalidReasonOf(m: Message | null): 'meta' | 'collapse' | null {
  if (m === null) return null;
  const c = m.content;
  if (typeof c !== 'string') return null;
  if (!c.trim() || c.startsWith(META_ONLY_PLACEHOLDER)) return 'meta';
  if (isCollapsedText(c)) return 'collapse';
  return null;
}

/** 单章链结果：msg=null 即本章失败（reason 供任务 failed）；cancelled=段间取消（D6 非 failure） */
export interface ChapterOutcome {
  msg: Message | null;
  reason?: string;
  cancelled?: boolean;
}
