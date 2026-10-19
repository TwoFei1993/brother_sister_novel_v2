/**
 * novel 模式写作要求注入（用户需求：每章字数可控 + 输出纪律）
 *
 * - buildNovelMainPrompt：兜底主提示词（无预设时），字数读作品设置（原硬编码 1500 已废弃）
 * - buildChapterRequirement：末尾写作要求块——随「剧情指引」合并注入 messages 最末位的
 *   user 消息（最强注意力位置），**不依赖用户预设**（绑定了预设也能生效）
 */
import type { TavernPrompt } from '@shared/tavern';

/** novel 兜底主提示词：无预设时让模型以小说作家身份按章续写（质量测试 T5 教训：无主提示词会退化成通用助手） */
export function buildNovelMainPrompt(targetWords: number): TavernPrompt {
  return {
    identifier: 'main',
    name: '内置作家主提示词',
    role: 'system',
    system_prompt: true,
    content:
      '你是一位资深中文小说作家。请根据上方的全部设定与剧情指引，续写下一章正文：\n' +
      '- 以小说笔法叙事，融合场景、动作、对话与心理描写，人物性格与关系保持前后一致\n' +
      '- 情节必须承接聊天历史中的前文，不得另起炉灶\n' +
      `- 每章正文不少于 ${targetWords} 字；直接输出正文本身\n` +
      '- 不要输出章节标题、编号、总结、写作说明或任何与正文无关的元信息\n' +
      '- 绝不以 AI、助手、模型身份说话',
  };
}

/** 末尾写作要求块：字数下限 + 输出纪律（对照实测泄露形态：对 System 寒暄 / 确认语 / 思考流 / 选项） */
export function buildChapterRequirement(targetWords: number): string {
  return (
    '【本章写作要求】\n' +
    `- 本章正文不少于 ${targetWords} 字（不含标题与任何元信息），写满本章内容再收尾，禁止提前收束\n` +
    '- 直接输出正文：禁止与 System/系统/用户对话或寒暄，禁止确认语（如「收到」「可以开始吗」）、' +
    '禁止输出思考过程、写作提纲、选项列表\n' +
    '- 禁止复述本要求或剧情指令原文'
  );
}
