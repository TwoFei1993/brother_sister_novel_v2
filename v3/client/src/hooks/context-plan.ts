/**
 * 上下文规划层（从 generation-pipeline.ts 迁出；设计 §5.1 / §5.3）
 *
 * 职责：兜底预设构建（EMPTY_PRESET 骨架 / novel·chat 主提示词 / 收尾层）与
 * 预算内上下文规划（planContext 切分 + summarizeDropped 滚动摘要）。
 * generation-pipeline.ts 的 scanAndAssemble 仍按原流程调用本模块，并 re-export 保持兼容。
 */
import type { Message } from '@shared/message';
import type { TavernPreset, TavernPrompt } from '@shared/tavern';
import { CHAT_REPLY_LENGTH_RANGE, type ChatReplyLength } from '@shared/work';

import { apiFetch } from '../api/client';
import { countTokensApprox } from '../engine/budget';
import { buildSummarizePrompt } from '../engine/prompt/memory';
import type { ScanSettings } from '../engine/worldbook';
import type { LlmPrefs } from '../stores/settings';

/** 世界书扫描全局设置（scanDepth 固定 10；条目级 scanDepth 可更深） */
export const SCAN_SETTINGS: ScanSettings = {
  scanDepth: 10,
  caseSensitive: false,
  matchWholeWords: false,
  recursive: true,
  maxRecursionSteps: 10,
};

/**
 * 预设缺失兜底：标准酒馆 marker 骨架（Default 预设的 marker 顺序，无内容提示词）。
 * 关键：worldInfoBefore/After 必须在列——否则只绑世界书不绑预设时，扫描命中的条目
 * 内容会因 prompt_order 无处装填而被静默丢弃（M3 验收发现并修复）。
 * main/jailbreak 无预设时 blocks 取空串自然跳过；卡字段由 marker 位置装填。
 */
export const EMPTY_PRESET: TavernPreset = {
  prompts: [],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'charPersonality', enabled: true },
        { identifier: 'scenario', enabled: true },
        { identifier: 'worldInfoAfter', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'jailbreak', enabled: true },
      ],
    },
  ],
};

/** novel 兜底主提示词：无预设时让模型以小说作家身份按章续写（质量测试 T5 教训：无主提示词会退化成通用助手） */
const FALLBACK_NOVEL_MAIN: TavernPrompt = {
  identifier: 'main',
  name: '内置作家主提示词',
  role: 'system',
  system_prompt: true,
  content:
    '你是一位资深中文小说作家。请根据上方的全部设定与剧情指引，续写下一章正文：\n' +
    '- 以小说笔法叙事，融合场景、动作、对话与心理描写，人物性格与关系保持前后一致\n' +
    '- 情节必须承接聊天历史中的前文，不得另起炉灶\n' +
    '- 每章正文约 1500 字；直接输出正文本身\n' +
    '- 不要输出章节标题、编号、总结、写作说明或任何与正文无关的元信息\n' +
    '- 绝不以 AI、助手、模型身份说话',
};

/** chat 兜底主提示词：无预设时强制沉浸式角色扮演（{{char}} 由宏环境解析为当前发言角色）。
 *  回复长度按作品 chatReplyLength 档位生成（用户反馈四问③：200-500 字太短，默认档加长至 400-900） */
export function buildChatMainPrompt(replyLength: ChatReplyLength): TavernPrompt {
  const { min, max } = CHAT_REPLY_LENGTH_RANGE[replyLength];
  return {
    identifier: 'main',
    name: '内置角色扮演主提示词',
    role: 'system',
    system_prompt: true,
    content:
      '你将完全扮演{{char}}，进行沉浸式角色扮演对话：\n' +
      '- 始终以{{char}}的身份、口吻说话与行动，用小说笔法描写（对话、动作、心理、环境）\n' +
      `- 每轮回复约 ${min}-${max} 字；严格遵循上方世界观与角色设定，主动推动剧情\n` +
      '- 绝不跳出角色，绝不承认自己是 AI 或助手；不要在回复开头加角色名前缀',
  };
}

/** 通用兜底收尾层：禁止元信息与思维过程外泄 */
const FALLBACK_JAILBREAK: TavernPrompt = {
  identifier: 'jailbreak',
  name: '内置收尾要求',
  role: 'system',
  system_prompt: true,
  content:
    '输出要求（最高优先级）：你的输出就是正文/对话本身——禁止任何旁白解释、写作提纲、思维过程（如 <thinking> 块）或「以下是/本章完」类元信息。',
};

/** 按模式构建兜底预设（marker 骨架 + 中文主提示词；卡覆盖开关仍可替换 main）。
 *  chat 模式的兜底主提示词按回复长度档位生成（novel 主提示词不消费长度档） */
export function buildFallbackPreset(tailKind: 'directive' | 'userMessage', replyLength: ChatReplyLength = 'medium'): TavernPreset {
  return {
    ...EMPTY_PRESET,
    prompts: [tailKind === 'directive' ? FALLBACK_NOVEL_MAIN : buildChatMainPrompt(replyLength), FALLBACK_JAILBREAK],
  };
}

/** 上下文规划（纯函数）：预算装得下则全量保留；装不下时从最旧侧切出 dropped（待摘要区） */
export function planContext(history: Message[], budget: number): { kept: Message[]; dropped: Message[] } {
  const tokens = history.map((m) => countTokensApprox(m.content));
  const total = tokens.reduce((a, b) => a + b, 0);
  if (total <= budget) return { kept: history, dropped: [] };
  let acc = 0;
  let cut = history.length;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    acc += tokens[i];
    if (acc > budget) {
      cut = i + 1;
      break;
    }
  }
  return { kept: history.slice(cut), dropped: history.slice(0, cut) };
}

/** 滚动摘要（防失忆）：把被预算切出的最旧消息压缩为摘要文本；失败返回 null（生成不阻塞） */
export async function summarizeDropped(
  prefs: LlmPrefs,
  prevSummary: string | undefined,
  texts: string[],
): Promise<string | null> {
  if (texts.length === 0) return null;
  const { system, user } = buildSummarizePrompt(prevSummary ?? '', texts);
  try {
    const out = (await apiFetch('/api/llm/generate', {
      method: 'POST',
      body: JSON.stringify({
        source: prefs.source,
        model: prefs.model || undefined,
        stream: false,
        params: { max_tokens: 700, temperature: 0.3 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })) as { text?: string };
    const text = out.text?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
}
