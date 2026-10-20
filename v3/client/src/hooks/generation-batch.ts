/**
 * 批量生成循环编排（⚡连写 / 📖按大纲）：useGenerate 的可测编排层。
 *
 * runChunkLoop：每轮默认写 3 章（BATCH_CHUNK_SIZE，短批次控长上下文质量退化风险），
 *   写到 desiredChapterCount 即停；首章用传入指令、后续空指令自由发挥。
 * runOutlineLoop：从「下一章」起按 settings.chapterOutlines 逐章写到覆盖的最大章号
 *   （outlineRunPlan；区别于目标章节数），每章指令恒为「按本章大纲写」——本章要点由
 *   scanAndAssemble 的 chapterOutlineDirective 按章号自动注入。
 * 共用约定：每轮从 work store 读最新 messages；每章完成 upsertLocal；
 *   出错（null）/用户停止即停，已入库章节保留；防重入（单章生成中不可发起）。
 */
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

import {
  BATCH_CHUNK_SIZE,
  OUTLINE_DIRECTIVE,
  outlineRunPlan,
  remainingChapters,
  nextChapterIndex,
  type BatchProgress,
} from './generation-flow';
import { useGenerationStore } from '../stores/generation';
import { useWorkStore } from '../stores/work';

/** 单章生成器（useGenerate.generateChapter 注入：内部已含大纲注入 + 守卫 + 无效输出重试） */
export type ChapterRunner = (work: Work, messages: Message[], directive: string) => Promise<Message | null>;

/** 取消标志的最小形状（useGenerate 的 batchCancelRef 注入；stop() 置位、循环末复位） */
export type CancelFlag = { current: boolean };

/** ⚡连写：写到目标章数即停（每轮 BATCH_CHUNK_SIZE 章）；错误/停止即停 */
export async function runChunkLoop(
  work: Work,
  firstDirective: string,
  generateChapter: ChapterRunner,
  cancelRef: CancelFlag,
  setBatch: (b: BatchProgress | null) => void,
): Promise<void> {
  const total = work.settings.desiredChapterCount;
  if (useGenerationStore.getState().streaming) return; // 防重入（单章生成中不可发起连写）
  cancelRef.current = false;
  try {
    let first = true;
    for (let done = 0; done < BATCH_CHUNK_SIZE; done++) {
      const messages = useWorkStore.getState().messages;
      if (remainingChapters(messages, total) <= 0 || cancelRef.current) break;
      setBatch({ done: nextChapterIndex(messages) - 1, total, mode: 'chunk' });
      const msg = await generateChapter(work, messages, first ? firstDirective : '');
      first = false;
      if (msg) useWorkStore.getState().upsertLocal(msg);
      if (!msg || cancelRef.current) break; // 出错/停止即停（error 已进 store 提示）
    }
  } finally {
    setBatch(null);
    cancelRef.current = false;
  }
}

/** 📖按大纲：从下一章逐章写到大纲覆盖的最大章号（plan 发起时快照）；错误/停止即停 */
export async function runOutlineLoop(
  work: Work,
  messages: Message[],
  generateChapter: ChapterRunner,
  cancelRef: CancelFlag,
  setBatch: (b: BatchProgress | null) => void,
): Promise<void> {
  const plan = outlineRunPlan(messages, work.settings.chapterOutlines);
  if (!plan) return; // 无大纲/已覆盖完：按钮不应出现，防御兜底
  if (useGenerationStore.getState().streaming) return; // 防重入
  cancelRef.current = false;
  try {
    for (let remain = plan.total; remain > 0; remain--) {
      const current = useWorkStore.getState().messages;
      if (cancelRef.current) break;
      setBatch({ done: plan.total - remain, total: plan.total, mode: 'outline' });
      const msg = await generateChapter(work, current, OUTLINE_DIRECTIVE);
      if (msg) useWorkStore.getState().upsertLocal(msg);
      if (!msg || cancelRef.current) break; // 出错/停止即停
    }
  } finally {
    setBatch(null);
    cancelRef.current = false;
  }
}
