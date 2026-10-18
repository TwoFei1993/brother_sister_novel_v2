/**
 * 大纲向导单测（Task 32）：样本大纲抽取人物/背景/势力/矛盾 + 卡/世界书草稿构建。
 * 样本为手写中文网文大纲，覆盖括号名人物、能力行、小节编号等真实形态。
 */
import { describe, expect, it } from 'vitest';

import { buildCardDraft, buildWorldbookDraft, extractFromOutline } from '../outline-wizard';

const SAMPLE = `《九州灵潮》

一、故事背景：灵气复苏的大周王朝，凡人可修行问道，宗门林立。
二、主要人物
哥哥（林昭）：天赋觉醒古龙血脉，性格沉稳坚毅，重情重义，背负家族血仇。
妹妹（林婉儿）：精通上古阵法，古灵精怪，心思缜密，惧怕孤独。
三、势力格局：天玄宗、丹王谷、魔罗殿三足鼎立。
四、核心矛盾：林家灭门惨案背后，隐藏着魔罗殿夺舍天下的阴谋。
哥哥能力：古龙血脉，可短暂化身龙形，力量翻倍。
妹妹能力：阵法天赋，可布下困龙阵困住强敌。`;

describe('extractFromOutline', () => {
  it('样本大纲：抽取背景/势力/矛盾', () => {
    const out = extractFromOutline(SAMPLE);
    expect(out.background).toContain('灵气复苏的大周王朝');
    expect(out.factions.join('')).toContain('天玄宗');
    expect(out.conflict).toContain('魔罗殿');
  });

  it('样本大纲：抽取带身份的人物与特质', () => {
    const out = extractFromOutline(SAMPLE);
    const brother = out.characters.find((c) => c.name === '林昭');
    const sister = out.characters.find((c) => c.name === '林婉儿');
    expect(brother).toBeDefined();
    expect(brother?.role).toBe('哥哥');
    expect(brother?.traits.join('')).toContain('沉稳坚毅');
    expect(sister).toBeDefined();
    expect(sister?.traits.join('')).toContain('心思缜密');
  });

  it('样本大纲：抽取哥哥/妹妹能力行', () => {
    const out = extractFromOutline(SAMPLE);
    expect(out.abilities.join('|')).toContain('古龙血脉');
    expect(out.abilities.join('|')).toContain('困龙阵');
  });

  it('空文本容错：返回全空结构不抛错', () => {
    const out = extractFromOutline('');
    expect(out.characters).toEqual([]);
    expect(out.background).toBe('');
    expect(out.abilities).toEqual([]);
    expect(out.factions).toEqual([]);
    expect(out.conflict).toBe('');
  });

  it('无名字人物行：用身份词兜底命名', () => {
    const out = extractFromOutline('哥哥：天生的战体，冷静果决。');
    expect(out.characters).toHaveLength(1);
    expect(out.characters[0]?.name).toBe('哥哥');
    expect(out.characters[0]?.traits.join('')).toContain('冷静果决');
  });

  it('章节编号行不误判为人物', () => {
    const out = extractFromOutline('第一章：初入宗门\n第二章：历练风波');
    expect(out.characters).toEqual([]);
  });
});

describe('buildCardDraft', () => {
  it('字段完整：spec/description/personality/scenario 齐备', () => {
    const extracted = extractFromOutline(SAMPLE);
    const card = buildCardDraft(extracted, '林昭');
    expect(card.spec).toBe('chara_card_v2');
    expect(card.data.name).toBe('林昭');
    expect(card.data.description).toContain('古龙血脉');
    expect(card.data.description).toContain('沉稳坚毅');
    expect(card.data.description).toContain('灵气复苏的大周王朝');
    expect(card.data.personality).toContain('沉稳坚毅');
    expect(card.data.scenario).toContain('灵气复苏');
  });

  it('名字缺失兜底：未知人物名 → 未命名角色且不抛错', () => {
    const extracted = extractFromOutline('');
    const card = buildCardDraft(extracted, '');
    expect(card.data.name).toBe('未命名角色');
    expect(card.spec).toBe('chara_card_v2');
  });
});

describe('buildWorldbookDraft', () => {
  it('背景/势力/矛盾生成 constant 条目', () => {
    const extracted = extractFromOutline(SAMPLE);
    const draft = buildWorldbookDraft(extracted);
    const entries = Object.values(draft.raw.entries);
    expect(entries.length).toBeGreaterThanOrEqual(3); // 背景 + 势力 + 矛盾
    expect(entries.every((e) => e.constant === true)).toBe(true);
    expect(entries.map((e) => e.content).join('')).toContain('天玄宗');
    expect(entries.map((e) => e.content).join('')).toContain('夺舍天下');
    expect(draft.name.length).toBeGreaterThan(0);
  });

  it('空抽取：世界书为空 entries 且结构合法', () => {
    const draft = buildWorldbookDraft(extractFromOutline(''));
    expect(Object.keys(draft.raw.entries)).toEqual([]);
    expect(draft.name.length).toBeGreaterThan(0);
  });
});
