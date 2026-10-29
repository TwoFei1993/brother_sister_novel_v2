/**
 * 移动创作分区共用类型：章节消息别名与生成编排的最小切片。
 */
import type { Message } from '@shared/message';
import type { UseGenerateResult } from '../../../../hooks/useGenerate';

export type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };

export type Gen = Pick<
  UseGenerateResult,
  'streaming' | 'streamingWorkId' | 'buffer' | 'partialKept' | 'error' | 'clearError' | 'generateChapter' | 'continueFromPartial' | 'swipeRegenerate' | 'thinkingBuffer' | 'runBatch' | 'runByOutline' | 'batch'
>;
