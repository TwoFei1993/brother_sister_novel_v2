/**
 * 上下文规划层纯内核（自 client/src/hooks/context-plan.ts 拆分下沉；设计 §5.1 / §5.3）
 *
 * 职责：兜底预设构建（EMPTY_PRESET 骨架 / novel·chat 主提示词 / 收尾层）与
 * 预算内上下文规划（planContext 切分）。滚动摘要 summarizeDropped 因内部走
 * apiFetch 调 LLM 留在 client（本文件仅携带其类型签名 SummarizeDropped，
 * server 端 Chunk 3 组装可按同签名注入自己的 LLM IO 实现）。
 *
 * 类型缝：本模块不引 client 的 LlmPrefs（zustand 文件），prefs 用结构最小类型
 * SummarizePrefs——client LlmPrefs 为其结构超集，天然兼容。
 */
import type { Message } from '@shared/message';
import type { TavernPreset, TavernPrompt } from '@shared/tavern';
import {
  CHAT_REPLY_LENGTH_RANGE,
  DEFAULT_TARGET_CHAPTER_WORDS,
  type ChatReplyLength,
} from '@shared/work';

import { countTokensApprox } from '../budget';
import type { ScanSettings } from '../worldbook';

import { buildSummarizePrompt } from './novel/memory';
import { buildNovelMainPrompt } from './novel/requirements';
import type { SegmentInfo } from './novel/requirements';

/** 组装后的单条消息（与 server generateSchema 的 messageSchema 同形；client api/llm GenerateMessage 同名同构） */
export interface GenerateMessage {
  role: 'system' | 'user' | 'assistant';
  name?: string;
  content: string;
}

/** summarizeDropped 的 prefs 结构最小类型（client LlmPrefs 的可兼容子集） */
export interface SummarizePrefs {
  source: 'openai' | 'gemini' | 'claude';
  model?: string;
  maxContext?: number;
  maxTokens?: number;
}

/** 滚动摘要的类型签名（实现留 client：apiFetch 调 LLM；失败返回 null，生成不阻塞） */
export type SummarizeDropped = (
  prefs: SummarizePrefs,
  prevSummary: string | undefined,
  texts: string[],
) => Promise<string | null>;

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

/** 通用兜底收尾层：禁止元信息与思维过程外泄 + 语言纯度（推理模型英文思考/自我纠错渗入正文的实测修复） */
const FALLBACK_JAILBREAK: TavernPrompt = {
  identifier: 'jailbreak',
  name: '内置收尾要求',
  role: 'system',
  system_prompt: true,
  content:
    '输出要求（最高优先级）：你的输出就是正文/对话本身——禁止任何旁白解释、写作提纲、思维过程（如 <thinking> 块）或「以下是/本章完」类元信息。\n' +
    '语言纯度（最高优先级）：全文只允许出现简体中文——思考也必须用简体中文；正文中禁止出现任何英文单词、英文字母、拼音、英文自我纠错（如 Wait/Stop/correct this 之类）；如果你发现自己在用英文，立即改为中文重写该句。',
};

/** 按模式构建兜底预设（marker 骨架 + 中文主提示词；卡覆盖开关仍可替换 main）。
 *  chat 模式的兜底主提示词按回复长度档位生成；novel 主提示词按每章目标字数生成 */
export function buildFallbackPreset(
  tailKind: 'directive' | 'userMessage',
  replyLength: ChatReplyLength = 'medium',
  targetWords: number = DEFAULT_TARGET_CHAPTER_WORDS,
): TavernPreset {
  return {
    ...EMPTY_PRESET,
    prompts: [
      tailKind === 'directive' ? buildNovelMainPrompt(targetWords) : buildChatMainPrompt(replyLength),
      FALLBACK_JAILBREAK,
    ],
  };
}

/** 输出守卫（novel）：预设自带的思维链框架（如 Sudachi 类）可能让模型把输出耗在思考上——
 *  只回思考没有正文视为无效。追加在消息最末尾（贴近生成点，遵循最强；对齐 chat 侧长度 hint 位置）。
 *  字数与 buildChapterRequirement 同源（targetWords），避免同一末尾出现两个矛盾的字数要求。
 *  role 用 user：部分 OpenAI 兼容桥接要求末条为 user / system 仅可居首，尾部 system 会 400
 *  （claude 通道本就会把尾部 system 降级为 user，见 server converters/claude.ts——此处直接对齐全通道一致）。
 *  continuation=true（用户反馈③）：续写轮改用「无缝续写」守卫——常规守卫的「第一行输出标题」
 *  在续写轮等于命令模型重新开章（已写半章 + 模型重开另写，拼接后一章两个开头）。 */
export function withNovelOutputGuard(messages: GenerateMessage[], targetWords: number, continuation = false): GenerateMessage[] {
  const content = continuation
    ? `（输出守卫：完成思考/提纲后，必须紧接着输出续写正文——只有思考没有正文视为无效输出。这是本章的续写：严禁重新开始本章、严禁输出章节标题、严禁重写已有内容，从已写正文的结尾直接接着写；正文中不得出现思考过程、提纲、要点列表或选项，续写到本章目标字数约 ${targetWords} 字为止。）`
    : `（输出守卫：完成思考/提纲后，必须紧接着输出完整章节正文——只有思考没有正文视为无效输出。正文第一行先输出「# 第N章 标题」标题行再写正文；正文中不得出现思考过程、提纲、要点列表或选项，字数不少于 ${targetWords} 字。）`;
  return [...messages, { role: 'user' as const, content }];
}

/** novel 守卫的组装侧接入（规范回补自 generation-pipeline 迁出）：预算需预留守卫自身开销，
 *  否则最紧预算下最终请求会超限约几十 token。allowance=守卫 token 开销；withGuard=组装后追加守卫。
 *  continuation：续写轮守卫变体（见 withNovelOutputGuard）。 */
export function novelGuardPlan(
  targetWords: number,
  continuation = false,
): {
  allowance: number;
  withGuard: (msgs: GenerateMessage[]) => GenerateMessage[];
} {
  const guard = withNovelOutputGuard([], targetWords, continuation)[0]!;
  return {
    allowance: countTokensApprox(guard.content),
    withGuard: (msgs) => [...msgs, guard],
  };
}

/** 末轮注入通道（自 generation-pipeline 迁出；review #7 参数化，novel/chat 共用同一 scanAndAssemble）：
 *  novel=剧情指令 directive（「剧情指引：…」包装）/ chat=用户消息 userMessage（§4.3）。
 *  directive.continuation（用户反馈③）：截断续写/断流恢复轮置 true——要求块与输出守卫
 *  切换为「无缝续写」变体，不再要求「第一行输出章标题」（该指令在续写轮 = 命令模型重新开章）。
 *  directive.expandChapter（用户需求：本章加长）：扩写轮置 true——要求块切「扩写本章」变体
 *  （基于上下文最后的当前版本输出更长完整章，守卫保持常规带标题形态）。 */
export type AssembleTail =
  | {
      kind: 'directive';
      text: string;
      continuation?: boolean;
      expandChapter?: boolean;
      segment?: SegmentInfo;
      /** 续写轮剩余字数（target−已有）：要求块按「补完剩余后收束」改写，防章节膨胀 */
      continueRemaining?: number;
    }
  | { kind: 'userMessage'; text: string };

/** 组装产物（自 generation-pipeline 迁出；预算校验后的上下文规划层结果） */
export interface FittedPrompt {
  messages: GenerateMessage[];
  /** tokenize 实测总 token（超预算多截后） */
  promptTokens: number;
  truncated: boolean;
  activatedIds: string[];
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
