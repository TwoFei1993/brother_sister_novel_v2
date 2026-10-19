/**
 * 装配总装（设计 §5.1④ / §4.4 卡覆盖规则）
 *
 * 语义锚点：酒馆 openai.js
 * - preparePromptsForChatCompletion(:1367)：prompt_order 装填 + 卡
 *   system_prompt/post_history_instructions 覆盖 main/jailbreak（:1498/:1508）
 * - populateChatHistory(:880)：历史从新→旧装填，装不下停（fillBudget）
 * - populationInjectionPrompts(:810)：messages 倒序数组、按 depth 遍历
 *   splice(depth + totalInserted)、同 depth 按 order 降序分组、组内 role
 *   system→user→assistant 处理，末尾 reverse 回正序（system 优先级最高、
 *   正序中贴近最新消息——"most important go lower"）
 *
 * marker 顺序由 prompt_order 驱动；摘要块固定挂在 chatHistory 前，
 * 设定块（NovelSettings 概要）拼接在 scenario 块之后，模式指令在最后。
 */
import type { TavernCardV2, TavernPreset, TavernPrompt, TavernRegexScript } from '@shared/tavern';
import type { Message } from '@shared/message';
import type { NovelSettings } from '@shared/work';

import { countTokensApprox, fillBudget } from '../budget';
import type { MacroEnv } from '../types';
import type { ScanResult } from '../worldbook/types';
import { substituteParams } from './macros';
import { getRegexedString, type RegexPlacement } from './regex';

// 作品设定块在 settings-block.ts（规范回补迁出；此处 re-export 保持兼容）
export { buildSettingsBlock, STYLE_GUIDE_MAX_CHARS } from './settings-block';
import { buildSettingsBlock } from './settings-block';

type Role = 'system' | 'user' | 'assistant';

export interface AssembleMessage {
  role: Role;
  name?: string;
  content: string;
}

export interface AssembleContext {
  /** 预设（prompts + prompt_order；调用方保证已按 character_id=100001 规范化） */
  preset: TavernPreset;
  /** 角色卡，按 characterIds 顺序 */
  cards: TavernCardV2[];
  /** Work 级开关「允许角色卡覆盖预设」（§4.4，默认开） */
  allowCardOverride: boolean;
  /** scanWorldInfo 产出 */
  worldbookScan: ScanResult;
  /** 作品设定（authorNote/noteDepth 在此） */
  workSettings: NovelSettings;
  /** 滚动摘要文本（可空） */
  summary?: string;
  /** 全量消息（旧→新） */
  history: Message[];
  /** novel 模式当前指令（追加为末尾 user 消息） */
  directive?: string;
  /** novel 末尾写作要求（字数 + 输出纪律，与 directive 合并为同一条末尾 user 消息；空指令时独立成条） */
  chapterRequirement?: string;
  /** chat 模式用户输入（追加为末尾 user 消息） */
  userMessage?: string;
  macroEnv: MacroEnv;
  /** 总预算 = max_context − max_tokens */
  budgetTokens: number;
  /**
   * 正则脚本（promptOnly 生成轨：静态块/深度注入项进上下文前应用；§5.1②）。
   * 历史消息不重复应用——全时脚本已在入库时生效，二次应用会双重替换
   * （酒馆 minDepth/maxDepth 提供的精细控制由脚本自身声明）。
   */
  regexScripts?: TavernRegexScript[];
}

export interface AssembleResult {
  messages: AssembleMessage[];
  usage: { promptTokens: number; truncated: boolean };
  activatedIds: string[];
}

/** 每条消息的协议开销近似值（role/name 包装），宁高勿低 */
const PER_MESSAGE_OVERHEAD = 4;

/** 卡数据字符串安全取值（nullish → 空串） */
const textOf = (v: string | null | undefined): string => (typeof v === 'string' ? v : '');

/** 按卡序取首张非空字段（§4.4 多卡规则） */
function firstNonEmpty(cards: TavernCardV2[], pick: (d: TavernCardV2['data']) => string | null | undefined): string {
  for (const card of cards) {
    const value = textOf(pick(card.data)).trim();
    if (value) return value;
  }
  return '';
}

/** 多卡同字段拼接（description/personality/scenario） */
function joinCards(cards: TavernCardV2[], pick: (d: TavernCardV2['data']) => string | null | undefined): string {
  return cards
    .map((c) => textOf(pick(c.data)).trim())
    .filter(Boolean)
    .join('\n\n');
}

/** depth_prompt.role 的 V2 字符串 / 数字枚举归一（0 system / 1 user / 2 assistant） */
function normalizeDepthRole(role: string | number | null | undefined): Role {
  if (role === 'user' || role === 1) return 'user';
  if (role === 'assistant' || role === 2) return 'assistant';
  return 'system';
}

/**
 * 深度注入（对齐 populationInjectionPrompts）：倒序历史序列按 depth 索引
 * splice 插入；同 depth 按 order 降序分组、组内 role system→user→assistant；
 * depth 超出序列长度时落在最旧之前（splice 语义，酒馆一致）。
 */
function injectAtDepth(seq: AssembleMessage[], injections: { content: string; depth: number; role: Role; order: number }[], env: MacroEnv): void {
  let totalInserted = 0;
  const maxDepth = injections.reduce((mx, i) => Math.max(mx, i.depth), 0);
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const atDepth = injections.filter((i) => i.depth === depth && i.content.trim());
    if (!atDepth.length) continue;
    const orders = [...new Set(atDepth.map((i) => i.order))].sort((a, b) => b - a);
    const roleMessages: AssembleMessage[] = [];
    for (const order of orders) {
      const group = atDepth.filter((i) => i.order === order);
      for (const role of ['system', 'user', 'assistant'] as const) {
        const contents = group
          .filter((i) => i.role === role)
          .map((i) => substituteParams(i.content, env).trim())
          .filter(Boolean);
        if (contents.length) roleMessages.push({ role, content: contents.join('\n') });
      }
    }
    if (roleMessages.length) {
      seq.splice(depth + totalInserted, 0, ...roleMessages);
      totalInserted += roleMessages.length;
    }
  }
}

/** 装配总装主入口（纯函数；预算与截断见 usage） */
export function assemblePrompt(ctx: AssembleContext): AssembleResult {
  const env = ctx.macroEnv;
  const order = ctx.preset.prompt_order?.[0]?.order ?? [];
  const promptById = new Map<string, TavernPrompt>(ctx.preset.prompts.map((p) => [p.identifier, p]));

  // ---------- 正则生成轨（promptOnly）：宏替换后、进上下文前应用（酒馆 populate → regex 时序） ----------
  const regexScripts = ctx.regexScripts ?? [];
  const applyPromptRegex = (text: string, placement: RegexPlacement): string =>
    regexScripts.length ? getRegexedString(text, placement, { isPrompt: true, macroEnv: env }, regexScripts) : text;

  // ---------- 素材块（§4.4：卡覆盖取首张非空，受 Work 开关控制） ----------
  const mainOverride = ctx.allowCardOverride ? firstNonEmpty(ctx.cards, (d) => d.system_prompt) : '';
  const jbOverride = ctx.allowCardOverride ? firstNonEmpty(ctx.cards, (d) => d.post_history_instructions) : '';
  const settingsBlock = buildSettingsBlock(ctx.workSettings);
  const scenarioText = [joinCards(ctx.cards, (d) => d.scenario), settingsBlock].filter(Boolean).join('\n\n');

  const blocks: Record<string, string> = {
    main: mainOverride || textOf(promptById.get('main')?.content),
    worldInfoBefore: ctx.worldbookScan.before.join('\n\n'),
    charDescription: joinCards(ctx.cards, (d) => d.description),
    charPersonality: joinCards(ctx.cards, (d) => d.personality),
    scenario: scenarioText,
    worldInfoAfter: ctx.worldbookScan.after.join('\n\n'),
    jailbreak: jbOverride || textOf(promptById.get('jailbreak')?.content),
  };

  // ---------- 按 prompt_order 输出静态块（chatHistory 处切分为 head/tail） ----------
  const head: AssembleMessage[] = [];
  const tailBlocks: AssembleMessage[] = [];
  let afterHistory = false;
  for (const entry of order) {
    if (!entry.enabled) continue; // 忽略未启用的 marker/提示词
    if (entry.identifier === 'chatHistory') {
      afterHistory = true;
      continue;
    }
    const prompt = promptById.get(entry.identifier);
    let content = '';
    let role: Role = 'system';
    if (entry.identifier in blocks) {
      content = blocks[entry.identifier] ?? '';
      role = (prompt?.role as Role) ?? 'system';
    } else if (prompt && !prompt.marker && textOf(prompt.content).trim()) {
      // 启用的自定义提示词（酒馆 userRelativePrompts 行为）
      content = textOf(prompt.content);
      role = (prompt.role as Role) ?? 'system';
    } else {
      continue; // dialogueExamples 一期略；其余无内容 marker 跳过
    }
    if (!content.trim()) continue;
    // 世界书内容按酒馆语义走 world_info placement，其余静态块走 ai_output
    const placement: RegexPlacement =
      entry.identifier === 'worldInfoBefore' || entry.identifier === 'worldInfoAfter' ? 'world_info' : 'ai_output';
    (afterHistory ? tailBlocks : head).push({
      role,
      content: applyPromptRegex(substituteParams(content, env), placement),
    });
  }

  // 摘要块（固定挂 chatHistory 前，酒馆 summary marker 语义）
  const summaryMessage: AssembleMessage | null = ctx.summary?.trim()
    ? { role: 'system', content: applyPromptRegex(substituteParams(`【前文摘要】\n${ctx.summary}`, env), 'ai_output') }
    : null;

  // ---------- 模式末尾注入 ----------
  const modeTail: AssembleMessage[] = [];
  // novel：指令与写作要求（字数+输出纪律）合并为同一条末尾 user 消息——
  // 二者有其一即注入（空指令连写时要求块仍独立成条，保住最末位最强注意力位置）
  const novelTailText = [
    ctx.directive?.trim() ? `剧情指引：${substituteParams(ctx.directive, env)}` : '',
    ctx.chapterRequirement?.trim() ? substituteParams(ctx.chapterRequirement, env) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  if (novelTailText) {
    modeTail.push({ role: 'user', content: applyPromptRegex(novelTailText, 'ai_output') });
  }
  if (ctx.userMessage?.trim()) {
    modeTail.push({ role: 'user', content: applyPromptRegex(substituteParams(ctx.userMessage, env), 'ai_output') });
  }

  // ---------- 深度注入项收集：世界书 atDepth + 作者注释 + 卡 depth_prompt（promptOnly 轨同静态块） ----------
  const injections: { content: string; depth: number; role: Role; order: number }[] = ctx.worldbookScan.depthEntries.map(
    (e) => ({ ...e, content: applyPromptRegex(e.content, 'world_info') }),
  );
  const authorNote = textOf(ctx.workSettings.authorNote).trim();
  if (authorNote) {
    injections.push({
      content: applyPromptRegex(authorNote, 'ai_output'),
      depth: ctx.workSettings.noteDepth ?? 4,
      role: 'system',
      order: 100,
    });
  }
  const depthPrompt = ctx.cards
    .map((c) => c.data.extensions?.depth_prompt)
    .find((dp) => textOf(dp?.prompt).trim());
  if (depthPrompt?.prompt) {
    injections.push({
      content: applyPromptRegex(textOf(depthPrompt.prompt), 'ai_output'),
      depth: depthPrompt.depth ?? 4,
      role: normalizeDepthRole(depthPrompt.role),
      order: 100,
    });
  }

  // ---------- 历史装填：预算 = 总预算 − 静态块 − 注入项（新→旧，装不下截断最旧） ----------
  const staticTokens = [...head, ...tailBlocks, ...modeTail, ...(summaryMessage ? [summaryMessage] : [])]
    .map((m) => countTokensApprox(m.content) + PER_MESSAGE_OVERHEAD)
    .reduce((a, b) => a + b, 0);
  const injectionTokens = injections
    .map((i) => countTokensApprox(i.content) + PER_MESSAGE_OVERHEAD)
    .reduce((a, b) => a + b, 0);
  const historyBudget = Math.max(0, ctx.budgetTokens - staticTokens - injectionTokens);

  const chatNewToOld: AssembleMessage[] = [...ctx.history]
    .reverse()
    .map((m) => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as Role,
      name: m.name,
      content: substituteParams(m.content, env),
    }));
  const { included, truncated } = fillBudget(
    chatNewToOld,
    (m) => countTokensApprox(m.content) + PER_MESSAGE_OVERHEAD,
    historyBudget,
  );

  const historyMessages = [...included];
  injectAtDepth(historyMessages, injections, env);
  historyMessages.reverse();

  // ---------- 汇总与用量统计 ----------
  const messages = [
    ...head,
    ...(summaryMessage ? [summaryMessage] : []),
    ...historyMessages,
    ...tailBlocks,
    ...modeTail,
  ];
  const promptTokens = messages
    .map((m) => countTokensApprox(`${m.name ?? ''}${m.content}`) + PER_MESSAGE_OVERHEAD)
    .reduce((a, b) => a + b, 0);

  return { messages, usage: { promptTokens, truncated }, activatedIds: ctx.worldbookScan.activatedIds };
}
