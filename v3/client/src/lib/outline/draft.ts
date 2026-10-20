/**
 * 大纲抽取产物的草稿构建：角色卡（酒馆 V2）与世界书草稿。
 * 自 outline-wizard 迁出（Word 导入实测反馈新增「金手指/特殊能力」条目时顺带拆分，
 * 使 wizard.ts 回到 300 行内）；抽取逻辑见 ./wizard。
 */
import type { TavernCardV2, TavernWorldInfoEntry, TavernWorldInfoFile } from '@shared/tavern';

import type { ExtractedOutline } from './wizard';

/** 人物 → 酒馆 V2 角色卡草稿（身份/特质/背景/矛盾拼装进 description） */
export function buildCardDraft(extracted: ExtractedOutline, name: string): TavernCardV2 {
  const ch = extracted.characters.find((c) => c.name === name);
  const role = ch?.role ?? '';
  const traits = ch?.traits ?? [];
  const lines: string[] = [];
  if (role && role !== name) lines.push(`{{char}}的身份是${role}。`);
  if (traits.length > 0) lines.push(`性格与特质：${traits.join('、')}。`);
  if (extracted.background) lines.push(`世界背景：${extracted.background}`);
  if (extracted.conflict) lines.push(`核心矛盾：${extracted.conflict}`);

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: name || '未命名角色',
      description: lines.join('\n'),
      personality: traits.join('；'),
      scenario: extracted.background,
      first_mes: '',
      mes_example: '',
      creator_notes: '由大纲向导自动生成',
      creator: '',
      character_version: '',
      tags: ['outline-wizard'],
      alternate_greetings: [],
      system_prompt: '',
      post_history_instructions: '',
    },
  };
}

/** 世界书条目骨架（constant 恒注入，酒馆 newWorldInfoEntry 惯例字段）；outline-sheet 复用 */
export function constantEntry(uid: number, comment: string, content: string, keys: string[]): TavernWorldInfoEntry {
  return {
    uid,
    key: keys,
    keysecondary: [],
    comment,
    content,
    constant: true,
    vectorized: false,
    selective: false,
    selectiveLogic: 0,
    addMemo: true,
    order: 100,
    position: 0,
    disable: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    automationId: '',
    role: null,
    sticky: 0,
    cooldown: 0,
    delay: 0,
  };
}

/** 势力文本切分为词级 key（2-6 字短语） */
function factionKeys(text: string): string[] {
  return text
    .split(/[，,、。；;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 6)
    .slice(0, 8);
}

/** 背景/金手指/势力/矛盾 → 世界书草稿（全部 constant 条目） */
export function buildWorldbookDraft(extracted: ExtractedOutline): { name: string; raw: TavernWorldInfoFile } {
  const entries: TavernWorldInfoEntry[] = [];
  let uid = 0;
  if (extracted.background) {
    entries.push(constantEntry(uid++, '世界背景', extracted.background, ['世界', '背景', '大陆', '王朝']));
  }
  // 金手指/特殊能力（Word 导入实测补充）：全作级设定恒注入
  if (extracted.ability) {
    entries.push(constantEntry(uid++, '金手指/特殊能力', extracted.ability, ['金手指', '能力', '异能', '外挂']));
  }
  for (const faction of extracted.factions) {
    entries.push(constantEntry(uid++, '势力', faction, factionKeys(faction).length > 0 ? factionKeys(faction) : ['势力']));
  }
  if (extracted.conflict) {
    entries.push(constantEntry(uid++, '核心矛盾', extracted.conflict, ['矛盾', '冲突', '阴谋']));
  }
  return {
    name: '大纲世界书',
    raw: { entries: Object.fromEntries(entries.map((e) => [String(e.uid), e])) },
  };
}
