/**
 * 装配测试脚手架（worldbook-fixtures 同款拆分，控制单文件行数）
 */
import { aiVersion } from '@shared/message';
import { defaultNovelSettings } from '@shared/work';
import type { TavernCardV2, TavernPreset, TavernPrompt } from '@shared/tavern';

import type { AssembleContext } from '../prompt/assemble';
import type { MacroEnv, MacroScope } from '../types';
import type { ScanResult } from '../worldbook/types';

/** 标准预设：九个内置 marker + main/jailbreak 默认内容 */
export const STD_PROMPTS: TavernPrompt[] = [
  { identifier: 'main', role: 'system', content: 'MAIN默认主提示', system_prompt: true },
  { identifier: 'worldInfoBefore', marker: true },
  { identifier: 'charDescription', marker: true },
  { identifier: 'charPersonality', marker: true },
  { identifier: 'scenario', marker: true },
  { identifier: 'worldInfoAfter', marker: true },
  { identifier: 'dialogueExamples', marker: true },
  { identifier: 'chatHistory', marker: true },
  { identifier: 'jailbreak', role: 'system', content: 'JB默认越狱', system_prompt: true },
];
export const STD_ORDER = STD_PROMPTS.map((p) => ({ identifier: p.identifier, enabled: true }));

export function makePreset(prompts: TavernPrompt[] = STD_PROMPTS, order = STD_ORDER): TavernPreset {
  return { prompts, prompt_order: [{ character_id: 100001, order }] };
}

export function makeCard(overrides: Partial<TavernCardV2['data']> = {}): TavernCardV2 {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '爱丽丝',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      creator: '',
      character_version: '',
      tags: [],
      alternate_greetings: [],
      extensions: {},
      ...overrides,
    },
  };
}

export const EMPTY_SCAN: ScanResult = { before: [], after: [], depthEntries: [], activatedIds: [] };

export function makeEnv(overrides: Partial<MacroEnv> = {}): MacroEnv {
  const store = new Map<string, string>();
  return {
    user: '阿明',
    char: '爱丽丝',
    scope: 'work',
    getVar: (name: string, scope: MacroScope) => store.get(`${scope}:${name}`),
    setVar: (name: string, value: string, scope: MacroScope) => {
      store.set(`${scope}:${name}`, value);
    },
    ...overrides,
  };
}

export function makeHistory(contents: string[]) {
  return contents.map((content, i) => ({
    id: `m${i}`,
    role: (i % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
    name: i % 2 === 0 ? '爱丽丝' : '作者',
    content,
    createdAt: i,
    swipes: [aiVersion(content, 'v1', i)],
    swipeId: 0,
    extra: {},
  }));
}

/** 组装上下文快捷构造：只覆写关心的字段 */
export function makeCtx(overrides: Partial<AssembleContext> = {}): AssembleContext {
  return {
    preset: makePreset(),
    cards: [makeCard({ description: '卡描述', personality: '卡性格', scenario: '卡场景' })],
    allowCardOverride: true,
    worldbookScan: EMPTY_SCAN,
    workSettings: { ...defaultNovelSettings },
    history: makeHistory(['历史一', '历史二']),
    macroEnv: makeEnv(),
    budgetTokens: 100000,
    ...overrides,
  };
}

/** 提取每条消息的可识别标记（内容首个 12 字符） */
export const tags = (messages: { content: string }[]) => messages.map((m) => m.content.slice(0, 12));
