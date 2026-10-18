/**
 * 记忆系统纯函数（设计 §5.3）
 *
 * 滚动摘要：每 N 章（assistant 章节消息计数）触发一次摘要任务。
 * 本模块只产出"是否摘要"的判定与"摘要 prompt"，LLM 调用由调用方
 * （useGenerate / Task 19）执行——引擎保持纯函数、不感知网络。
 */
import type { Message } from '@shared/message';

/**
 * 是否触发滚动摘要：assistant 章节消息数（带 chapter 元数据的 assistant 消息）
 * 为 everyN 的正整数倍时触发。everyN 非法（≤0）或章节数为 0 时不触发。
 */
export function shouldSummarize(messages: Message[], everyN: number): boolean {
  if (!Number.isFinite(everyN) || everyN <= 0) return false;
  const chapterCount = messages.filter((m) => m.role === 'assistant' && m.chapter).length;
  return chapterCount > 0 && chapterCount % everyN === 0;
}

/**
 * 构造摘要任务的 {system, user} 消息对。
 * 摘要指令：压缩前文，保留人物关系、伏笔、时间线，全文 ≤500 字。
 *
 * @param previousSummary 已有的滚动摘要（可空：首轮摘要无前文）
 * @param recentTexts     自上次摘要以来的章节正文（旧→新）
 */
export function buildSummarizePrompt(
  previousSummary: string,
  recentTexts: string[],
): { system: string; user: string } {
  const system = [
    '你是小说连载的剧情记录员，负责把前文压缩成一份连贯的剧情摘要。',
    '要求：',
    '1. 保留人物关系、性格要点与立场变化；',
    '2. 保留已埋设的伏笔与未回收的悬念；',
    '3. 保留时间线与关键事件的先后顺序；',
    '4. 省略具体对白与细节描写，只留剧情骨架。',
    '全文不超过 500 字，直接输出摘要正文，不要任何解释、标题或列表符号。',
  ].join('\n');

  const parts: string[] = [];
  if (previousSummary.trim()) {
    parts.push(`【已有摘要】\n${previousSummary.trim()}`);
  }
  parts.push('【最近章节】');
  recentTexts.forEach((text, i) => {
    parts.push(`[${i + 1}] ${text.trim()}`);
  });
  parts.push('请把以上内容合并为一份新的剧情摘要（≤500字）。');

  return { system, user: parts.join('\n\n') };
}
