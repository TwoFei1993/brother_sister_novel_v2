/**
 * 生成流 hook（novel 语义，设计 §3.2 数据流 / §9.1 重试 / §9.2 生成事务性）
 *
 * M2 Chunk 5 全任务化：所有章节生成操作统一提交 server novel-chapter 任务——
 *   chapter（按指令生成/一键连写/按大纲）/ swipe（重roll）/ continue（断流续写）/
 *   append|expand（本章续写/加长）。客户端只做：提交 + 增量回流（progressText →
 *   appendChunk 打字机视图）+ 终态按 resultMessageIds 同步本地视图；提交/轮询/取消/
 *   页面切换恢复收敛在 useNovelTask。分段、无效输出重试、截断自动续写、润色 pass、
 *   appendSwipe 候选追加等编排在 server（services/novel-gen，与旧 client 链逐点对齐）。
 * 旧 App 后台链（bg 分段任务 + PENDING 断点）与 client SSE 生成链已删除（2026-11-21）。
 */
import { useCallback, useState } from 'react';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

import { NOVEL_CHAPTERS_MAX } from '../lib/llmTask';
import { notifyDone, showToast } from '../lib/toast';
import { getGenSlot, selectStreamingWorkId, useGenSlot, useGenSlots, useGenerationStore, type GenProgress } from '../stores/generation';
import { useWorkStore } from '../stores/work';

import {
  MAX_SWIPES,
  OUTLINE_DIRECTIVE,
  nextChapterIndex,
  outlineRunPlan,
  remainingChapters,
  swipeLimitError,
  type BatchProgress,
} from './generation-flow';
import { useNovelTask } from './useNovelTask';

export interface UseGenerateResult {
  /** 本书槽位是否生成中（多槽化：其他书生成中不再阻塞本书操作；workId 未绑定时=任一槽） */
  streaming: boolean;
  /** 任一 streaming 槽的作品 id（null=无任何生成；兼容旧全局语义：书架/移动端标出「哪本在写」） */
  streamingWorkId: string | null;
  /** 存在非本书的 streaming 槽（「其他书生成中」派生语义——plan Chunk 4 多槽替代） */
  otherStreaming: boolean;
  /** 本书槽位的流式缓冲 */
  buffer: string;
  /** 思考流原文（推理模型💭；移动端 DeepSeek 式折叠块消费） */
  thinkingBuffer: string;
  error: { code: string; message: string } | null;
  partialKept: boolean;
  targetMessageId: string | null;
  /** 后台任务的章进度（任务内口径；null=非后台任务或未开始）——切出回来后的恢复路径同样有值 */
  progress: GenProgress | null;
  /** 本章上一稿被判无效、server 已自动重试（同章进度回落）——界面提示「上一稿无效，已自动重试」 */
  retried: boolean;
  /** novel 模式：按剧情指令生成一章，返回入库消息（失败返回 null） */
  generateChapter: (work: Work, messages: Message[], directive: string) => Promise<Message | null>;
  /** 断流后「继续」（mode=continue 任务）：半成品作 server 续写基底 */
  continueFromPartial: (work: Work, messages: Message[], partial: string) => Promise<Message | null>;
  /** 换一支（mode=swipe 任务）：同 directive 重生成，结果 push 进 target.swipes（幂等 upsert） */
  swipeRegenerate: (work: Work, messages: Message[], target: Message) => Promise<Message | null>;
  /** 本章加长/续写（mode=append|expand 任务）：append=从本章结尾续写追加变长；expand=扩写原地加厚。
   *  结果作为 target 的新候选版本追加（◀▶ 可回退原文），同 id 幂等覆盖 */
  extendChapter: (
    work: Work,
    messages: Message[],
    target: Message,
    mode: 'append' | 'expand',
  ) => Promise<Message | null>;
  /** 一键连写：从下一章自动写到目标章节数（第一章用传入指令、后续空指令自由发挥） */
  runBatch: (work: Work, firstDirective: string) => Promise<void>;
  /** 📖按大纲生成：从下一章起按章节大纲逐章写到覆盖的最大章号（每章自动注入本章大纲要点） */
  runByOutline: (work: Work, messages: Message[], limit?: number) => Promise<void>;
  /** 批量进度（null = 空闲；CommandBar 停止按钮进度文案消费） */
  batch: BatchProgress | null;
  /** 停止当前生成与连写循环（已产出部分保留在界面，「继续」可用） */
  stop: () => void;
  /** 关闭错误提示（保留半成品供继续） */
  clearError: () => void;
  /** 上一轮生成完成入库时上下文是否发生过截断（usage.truncated，界面提示条消费）——
   *  任务化后组装在 server，任务终态暂无此字段（挂账回传后接回），暂恒 false */
  lastTruncated: boolean;
  /** 关闭截断提示 */
  clearTruncated: () => void;
}

/**
 * @param workId 绑定本书槽位（WorkPage/MobileWork 传路由 id）：返回的 streaming/buffer/error 等
 *   均读本书槽；未绑定（测试/特殊场景）时 streaming 回退「任一槽」语义，其余字段读不到槽为空。
 */
export function useGenerate(workId?: string | null): UseGenerateResult {
  // novel-chapter 后台任务编排：提交 + 增量回流 + 终态同步 + mount 恢复轮询 + stop 取消全在此
  const novel = useNovelTask(workId);
  // 上下文截断提示（store 收束即清零，generationStore 不留痕，挂 hook 本地态最小改动）
  const [lastTruncated, setLastTruncated] = useState(false);
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const clearTruncated = useCallback(() => setLastTruncated(false), []);

  /**
   * 章节生成（M2 Chunk 4 切任务）：分段/无效输出重试/截断自动续写/润色 pass/
   * truncatedSwipeId 标记全部在 server 编排（与 client 旧链逐点对齐移植，见
   * services/novel-gen）；终态按 resultMessageIds 同步本地视图并返回末章。
   */
  const generateChapter = useCallback(
    async (work: Work, _messages: Message[], directive: string) => {
      const outcome = await novel.submitAndWait({ work, mode: 'chapter', directive, chapters: 1 });
      return outcome.messages.at(-1) ?? null;
    },
    [novel],
  );

  /**
   * 断流后「继续」（M2 Chunk 5 切任务，mode=continue）：半成品作 server 续写基底
   * （buildContinueDirective + 半章进历史 grounding 的续写轮语义在 server 编排）；
   * 终态按 resultMessageIds 取回入库消息（同 id 幂等覆盖语义 server 侧完成）。
   */
  const continueFromPartial = useCallback(
    async (work: Work, _messages: Message[], partial: string) => {
      const outcome = await novel.submitAndWait({ work, mode: 'continue', directive: '', partial });
      return outcome.messages.at(-1) ?? null;
    },
    [novel],
  );

  /**
   * 换一支（M2 Chunk 5 切任务，mode=swipe）：server 端 historyBeforeTarget 上下文
   * （被重roll章节的旧候选不进上下文）+ 无效输出重试 + 截断自动续写 + appendSwipe
   * 候选追加；终态取回更新后的 target 消息（新候选位于末位 swipe）。MAX_SWIPES 双层：
   * 客户端预检省一次往返，server 权威拒绝（兜底并发竞态）。
   */
  const swipeRegenerate = useCallback(
    async (work: Work, _messages: Message[], target: Message) => {
      if (target.swipes.length >= MAX_SWIPES) {
        useGenerationStore.getState().fail(work.id, swipeLimitError(), false);
        return null;
      }
      const outcome = await novel.submitAndWait({
        work,
        mode: 'swipe',
        directive: target.directive ?? '',
        targetId: target.id,
      });
      return outcome.messages.at(-1) ?? null;
    },
    [novel],
  );

  /**
   * 本章加长/续写（M2 Chunk 5 切任务，mode=append|expand，用户需求：卷章之外允许对当前章
   * 要求加长或续写）：append=从本章结尾续写新剧情（追加式变长）/ expand=扩写本章（原地加厚），
   * 上下文含本章、扩写轮关思考、maxTokensScale 2 等语义在 server 逐点对齐移植（runExtendMode）；
   * 新候选版本追加（◀▶ 可回退原文）经 server appendSwipe，同 id 幂等覆盖；per-work 防重入
   * 由任务提交层（useNovelTask）承担。
   */
  const extendChapter = useCallback(
    async (work: Work, _messages: Message[], target: Message, mode: 'append' | 'expand') => {
      const outcome = await novel.submitAndWait({ work, mode, directive: '', targetId: target.id });
      return outcome.messages.at(-1) ?? null;
    },
    [novel],
  );

  /** 停止：POST cancel + 槽 fail(null, partialKept)（D6：当前段跑完即停，已入库保留） */
  const stop = useCallback(() => {
    novel.stop();
  }, [novel]);

  /**
   * 一键连写（M2 Chunk 4 切任务）：提交 chapters=剩余章数（≤NOVEL_CHAPTERS_MAX，server 端
   * 按 BATCH_CHUNK_SIZE 批次屏障分批——长批次质量防线在 server 保留）→ 轮询 done 计数驱动
   * setBatch 进度 → 终态按 resultMessageIds 同步本地视图 + 汇总 toast（文案沿用旧循环语义）。
   */
  const runBatch = useCallback(
    async (work: Work, firstDirective: string): Promise<void> => {
      const total = work.settings.desiredChapterCount;
      const current = useWorkStore.getState().messages;
      const remaining = remainingChapters(current, total);
      if (remaining <= 0) return; // 已达目标：零请求
      if (getGenSlot(work.id)?.streaming) return; // 防重入（本书生成中不可发起连写）
      const baseIndex = nextChapterIndex(current) - 1;
      const chapters = Math.min(remaining, NOVEL_CHAPTERS_MAX);
      setBatch({ done: baseIndex, total, mode: 'chunk' });
      try {
        const outcome = await novel.submitAndWait({
          work,
          mode: 'chapter',
          directive: firstDirective,
          chapters,
          onProgress: (p) => setBatch({ done: baseIndex + p.done, total, mode: 'chunk' }),
        });
        const completed = outcome.messages
          .map((m) => m.chapter?.index ?? 0)
          .filter((n) => n > 0)
          .sort((a, b) => a - b);
        if (completed.length === 0) return; // 全部失败：error 已进槽提示，无汇总
        const left = remainingChapters(useWorkStore.getState().messages, total);
        if (outcome.stopped) {
          showToast(`⏹ 连写已停止——本次完成 ${completed.length} 章（第${completed.join('、第')}章），点「继续」可接着写`, { duration: 6000 });
        } else if (left > 0) {
          showToast(`本批 ${completed.length} 章完成（第${completed.join('、第')}章）——还剩 ${left} 章，再点「一键连写」继续`, { duration: 6000 });
        } else {
          notifyDone(`🎉 全书连写完成！目标 ${total} 章全部到位`, { duration: 6000 });
        }
      } finally {
        setBatch(null);
      }
    },
    [novel],
  );

  /**
   * 📖按大纲生成（反馈⑤，M2 Chunk 4 切任务）：提交 chapters=大纲剩余覆盖章数（outline=true
   * 走 server 大纲链，本章要点由 server 组装按章号自动注入）→ 轮询进度驱动 setBatch →
   * 终态同步 + 汇总 toast（文案沿用旧循环语义）。limit：本次最多写几章（用户可选「先写 N 章」）。
   */
  const runByOutline = useCallback(
    async (work: Work, messages: Message[], limit?: number): Promise<void> => {
      const plan = outlineRunPlan(messages, work.settings.chapterOutlines);
      if (!plan) return; // 无大纲/已覆盖完：按钮不应出现，防御兜底
      if (getGenSlot(work.id)?.streaming) return; // 防重入
      const chapters = Math.min(limit && limit > 0 ? Math.min(plan.total, limit) : plan.total, NOVEL_CHAPTERS_MAX);
      setBatch({ done: 0, total: chapters, mode: 'outline' });
      try {
        const outcome = await novel.submitAndWait({
          work,
          mode: 'chapter',
          directive: OUTLINE_DIRECTIVE,
          chapters,
          outline: true,
          onProgress: (p) => setBatch({ done: p.done, total: chapters, mode: 'outline' }),
        });
        const completed = outcome.messages
          .map((m) => m.chapter?.index ?? 0)
          .filter((n) => n > 0)
          .sort((a, b) => a - b);
        if (completed.length === 0) return;
        const left = outlineRunPlan(useWorkStore.getState().messages, work.settings.chapterOutlines);
        if (left && left.total > 0) {
          showToast(`本批按大纲完成 ${completed.length} 章（第${completed.join('、第')}章）——大纲还剩 ${left.total} 章`, { duration: 6000 });
        } else {
          notifyDone(`🎉 按大纲生成全部完成（${completed.length} 章）！`, { duration: 6000 });
        }
      } finally {
        setBatch(null);
      }
    },
    [novel],
  );

  const clearError = useCallback(() => {
    if (workId) useGenerationStore.getState().clearError(workId);
  }, [workId]);

  // 多槽化（M2 Chunk 4）：返回面按本书槽位派生（workId 绑定时）；streamingWorkId 保留
  // 「任一本在写」全局语义（书架/移动端标出「哪本在写」），本书状态看 streaming。
  const slot = useGenSlot(workId);
  const slots = useGenSlots();
  const streamingWorkId = useGenerationStore(selectStreamingWorkId);
  const otherStreaming = useGenerationStore((s) =>
    workId ? Object.keys(s.slots).some((k) => k !== workId && s.slots[k].streaming) : false,
  );

  return {
    streaming: workId ? (slot?.streaming ?? false) : Object.values(slots).some((x) => x.streaming),
    streamingWorkId,
    otherStreaming,
    buffer: slot?.buffer ?? '',
    thinkingBuffer: slot?.thinkingBuffer ?? '',
    error: slot?.error ?? null,
    partialKept: slot?.partialKept ?? false,
    targetMessageId: slot?.targetMessageId ?? null,
    progress: slot?.progress ?? null,
    retried: slot?.retried ?? false,
    generateChapter,
    continueFromPartial,
    swipeRegenerate,
    extendChapter,
    runBatch,
    runByOutline,
    batch,
    stop,
    clearError,
    lastTruncated,
    clearTruncated,
  };
}
