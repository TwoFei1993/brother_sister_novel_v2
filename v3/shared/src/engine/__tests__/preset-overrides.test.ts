/**
 * 预设条目分组识别 + 按书覆盖测试（用户需求 2026-11-24：「写作风格」= 预设内文风条目，按书生效）。
 * fixture 按 Sudachi-Next-Preset 的真实排版构造（顶级标题 `—\组名===`、子标题 `===名===`）。
 */
import { describe, expect, it } from 'vitest';

import type { TavernPreset, TavernPrompt } from '@shared/tavern';

import {
  applyPresetOverrides,
  detectPresetGroups,
  isEffective,
  extractPresetStyleText,
  pickSingle,
  resolveMainPreset,
  resolvePresetStyle,
  toggleMulti,
} from '../prompt/preset-overrides';
import type { MacroEnv } from '../types';

type Row = [identifier: string, name: string, content: string, enabled?: boolean];

const ROWS: Row[] = [
  ['main', '🐳主提示', 'MAIN'],
  ['h-regular', '—\\⚙常规设定===', '{{//存放常规设定，如文风，字数}}', true],
  ['num', '🔢字数设定', '{{setvar::mincount::[1200,1400]}}', true],
  ['h-style', '—\\📖文风设定===', '{{//单选}}', true],
  ['sub-new', '===📬新文===', '', true],
  ['n-light', '🔖N-轻小说', '<writing_style>日系轻小说</writing_style>', true],
  ['n-romance', '🌸N-恋爱', '<writing_style>恋爱</writing_style>', false],
  ['sub-old', '===📭老文===', '', true],
  ['light', '🔖轻小说', '{{setvar::style::日式轻小说}}', false],
  ['short-drama', '🔥短剧式', '{{setvar::style::短剧式}}', false],
  ['h-tone', '—\\🕰情感基调===', '<keynote>情感基调</keynote>', true],
  ['tone-general', '⚫通用', '<tone>自然平衡</tone>', true],
  ['tone-joy', '⚫欢快', '<tone>欢快明亮</tone>', false],
  ['h-person', '—\\🐧人称设定===', '{{//单选哈}}', true],
  ['person-1', '🕐第一人称', '<person>第一人称</person>', true],
  ['h-addon', '--\\📌附加选项===', '{{//可多选}}', true],
  // 子标题自带变量设置内容（真实 Sudachi 的「===❎反八股===」形态）：仍只当分区名，不算成员
  ['sub-body', '===📄正文优化===', '{{setvar::flag::1}}', true],
  ['anti-sf', '❎反科幻', '<anti_sci-fi>别像机器人</anti_sci-fi>', true],
  ['vivid', '🍈生动化', '<vivid>生动</vivid>', false],
  ['h-jb', '--\\🗝越狱===', '{{//抗截断}}', true],
  ['jb', '🔓抗截断', 'JB', false],
];

function presetFixture(): TavernPreset {
  const prompts: TavernPrompt[] = ROWS.map(([identifier, name, content]) => ({
    identifier, name, role: 'system', content, system_prompt: true,
  }));
  return {
    prompts,
    prompt_order: [{ character_id: 100001, order: ROWS.map(([identifier, , , enabled]) => ({ identifier, enabled: enabled ?? false })) }],
  };
}

const enabledOf = (preset: TavernPreset, id: string): boolean =>
  preset.prompt_order?.[0]?.order.find((o) => o.identifier === id)?.enabled === true;

describe('detectPresetGroups', () => {
  /** fixture 里的组按出现顺序：常规设定(其它) → 文风设定(style) → 情感基调(tone) → 人称设定(其它) → 附加选项(addon) → 越狱(其它) */
  it('识别 全部分组：文风(单选)/基调(多选)/附加(多选)，其余组名原样归 other（用户反馈 2026-11-27：不再整组丢弃）', () => {
    const groups = detectPresetGroups(presetFixture());
    // 组名存储时已剥掉装饰符（emoji 与 ===）
    expect(groups.map((g) => [g.name, g.category, g.mode])).toEqual([
      ['常规设定', 'other', 'multi'],
      ['文风设定', 'style', 'single'],
      ['情感基调', 'tone', 'multi'],
      ['人称设定', 'other', 'multi'],
      ['附加选项', 'addon', 'multi'],
      ['越狱', 'other', 'multi'],
    ]);
    const byName = (name: string) => groups.find((g) => g.name === name)!;
    expect(byName('常规设定').members.map((m) => m.identifier)).toEqual(['num']);
    expect(byName('文风设定').members.map((m) => m.identifier)).toEqual(['n-light', 'n-romance', 'light', 'short-drama']);
    expect(byName('情感基调').members.map((m) => m.identifier)).toEqual(['tone-general', 'tone-joy']);
    expect(byName('人称设定').members.map((m) => m.identifier)).toEqual(['person-1']);
    expect(byName('附加选项').members.map((m) => m.identifier)).toEqual(['anti-sf', 'vivid']);
    expect(byName('越狱').members.map((m) => m.identifier)).toEqual(['jb']);
  });

  it('成员带预设默认启停与子分组（新文/老文）', () => {
    const style = detectPresetGroups(presetFixture()).find((g) => g.category === 'style')!;
    expect(style.members[0]).toMatchObject({ identifier: 'n-light', name: '🔖N-轻小说', enabled: true, subsection: '新文' });
    expect(style.members[2]).toMatchObject({ identifier: 'light', enabled: false, subsection: '老文' });
  });

  it('无分组标题的预设 → 空数组；成员为空的组不产出', () => {
    expect(detectPresetGroups({ prompts: [], prompt_order: [] })).toEqual([]);
    const emptyGroup = presetFixture();
    const order = emptyGroup.prompt_order![0]!.order;
    emptyGroup.prompt_order![0]!.order = order.filter(
      (o) => !['tone-general', 'tone-joy'].includes(o.identifier),
    );
    expect(detectPresetGroups(emptyGroup).map((g) => [g.name, g.category])).toEqual([
      ['常规设定', 'other'],
      ['文风设定', 'style'],
      ['人称设定', 'other'],
      ['附加选项', 'addon'],
      ['越狱', 'other'],
    ]);
  });
});

describe('applyPresetOverrides', () => {
  it('空覆盖表 → 返回原对象（不复制）', () => {
    const preset = presetFixture();
    expect(applyPresetOverrides(preset, detectPresetGroups(preset), {})).toBe(preset);
  });

  it('单选组被本书选过：组内以覆盖表为准，未写到的成员一律关闭（选短剧式 → N-轻小说关）', () => {
    const preset = presetFixture();
    const groups = detectPresetGroups(preset);
    const next = applyPresetOverrides(preset, groups, { 'short-drama': true });
    expect(enabledOf(next, 'short-drama')).toBe(true);
    expect(enabledOf(next, 'n-light')).toBe(false);
    expect(enabledOf(next, 'n-romance')).toBe(false);
    // 组外条目不受影响
    expect(enabledOf(next, 'tone-general')).toBe(true);
    expect(enabledOf(next, 'person-1')).toBe(true);
  });

  it('多选组：只改写到的条目（勾欢快 → 通用保持开启，两条基调并存）', () => {
    const preset = presetFixture();
    const next = applyPresetOverrides(preset, detectPresetGroups(preset), { 'tone-joy': true });
    expect(enabledOf(next, 'tone-general')).toBe(true);
    expect(enabledOf(next, 'tone-joy')).toBe(true);
  });

  it('其它组（人称）条目的覆盖同样生效；预设里已不存在的 identifier 被忽略；不改原预设', () => {
    const preset = presetFixture();
    const snapshot = JSON.stringify(preset);
    const next = applyPresetOverrides(preset, detectPresetGroups(preset), { 'person-1': false, 'gone-entry': true });
    expect(enabledOf(next, 'person-1')).toBe(false);
    expect(JSON.stringify(preset)).toBe(snapshot);
    expect(next.prompt_order?.[0]?.order).toHaveLength(ROWS.length);
  });

  it('resolveMainPreset = 识别 + 应用；无覆盖返回原预设', () => {
    const preset = presetFixture();
    expect(resolveMainPreset(preset)).toBe(preset);
    expect(enabledOf(resolveMainPreset(preset, { 'vivid': true }), 'vivid')).toBe(true);
  });
});

describe('UI 状态助手', () => {
  const preset = presetFixture();
  const groups = detectPresetGroups(preset);
  const style = groups.find((g) => g.category === 'style')!;
  const tone = groups.find((g) => g.category === 'tone')!;

  it('isEffective：覆盖优先，否则预设默认', () => {
    const joy = tone!.members[1]!;
    expect(isEffective(tone!, joy, {})).toBe(false);
    expect(isEffective(tone!, joy, { 'tone-joy': true })).toBe(true);
    // 单选组被显式选过：组内只认覆盖表（未写「关」的默认条目也视为不生效）
    const light = style!.members[0]!;
    expect(isEffective(style!, light, {})).toBe(true);
    expect(isEffective(style!, light, { 'short-drama': true })).toBe(false);
  });

  it('pickSingle：选中项启用、组内原先生效的条目关闭；点已选中的保持不变', () => {
    const picked = pickSingle(style!, 'short-drama', {});
    expect(picked).toEqual({ 'short-drama': true, 'n-light': false });
    expect(pickSingle(style!, 'short-drama', picked)).toEqual(picked);
    // 在已有覆盖的基础上换选：旧的选中项关闭、早先关掉的保持 false
    const switched = pickSingle(style!, 'n-romance', picked);
    expect(isEffective(style!, style!.members[3]!, switched)).toBe(false);
    expect(switched).toEqual({ 'short-drama': false, 'n-light': false, 'n-romance': true });
  });

  it('toggleMulti：切换生效状态', () => {
    expect(toggleMulti(tone!, tone!.members[0]!, {})).toEqual({ 'tone-general': false });
    expect(toggleMulti(tone!, tone!.members[1]!, {})).toEqual({ 'tone-joy': true });
  });
});

/** 内存变量表 mock：同次组装内 setvar 后 getVar 即可读到（与 server buildMacroEnv 修复后的语义一致） */
function macroEnv(): MacroEnv {
  const store = new Map<string, string>();
  const env: MacroEnv = {
    user: '作者', char: '小说家', scope: 'work',
    getVar: (name, scope) => store.get(`${scope}:${name}`),
    setVar: (name, value, scope) => { store.set(`${scope}:${name}`, value); },
  };
  return env;
}

describe('extractPresetStyleText / resolvePresetStyle（预设文风提权到要求块）', () => {
  const preset = presetFixture();
  const style = detectPresetGroups(preset).find((g) => g.category === 'style')!;

  it('新文系（正文内联在条目里）：默认启用的 N-轻小说 → 提取出 <writing_style> 正文', () => {
    const text = extractPresetStyleText(style!, {}, macroEnv());
    expect(text).toContain('<writing_style>日系轻小说</writing_style>');
    expect(text).not.toContain('setvar'); // 尾部的 setvar 指针宏已消解
  });

  it('老文系（全文存进变量）：选「短剧式」→ 读到同次组装写入的变量值', () => {
    const env = macroEnv();
    const text = extractPresetStyleText(style!, pickSingle(style!, 'short-drama', {}), env);
    expect(text).toBe('短剧式');
    expect(env.getVar('style', 'work')).toBe('短剧式'); // 变量已就位（后文 <style> 条目的 getvar 读到同一值）
  });

  it('经 resolvePresetStyle 入口：只认文风组', () => {
    const groups = detectPresetGroups(presetFixture());
    const style = groups.find((g) => g.category === 'style')!;
    expect(resolvePresetStyle(groups, pickSingle(style, 'light', {}), macroEnv())).toBe('日式轻小说'); // 正文 setvar 里写的原文
  });

  it('未生效的条目不提取；无文风组 → 空串', () => {
    expect(extractPresetStyleText(style!, { 'n-light': false }, macroEnv())).toBe('');
    expect(resolvePresetStyle([], {}, macroEnv())).toBe('');
  });
});
