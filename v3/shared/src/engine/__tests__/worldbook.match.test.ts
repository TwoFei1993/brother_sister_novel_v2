/**
 * 世界书键匹配测试（matchKeys / matchEntry）
 * 锚点：酒馆 world-info.js matchKeys(:337)、parseRegexFromString(:2901)、
 * 主键判定(:4913 substituteParams 后 trim、空串不算命中)、
 * 二级键四逻辑(:4939-4975 AND_ANY/NOT_ALL/NOT_ANY/AND_ALL)。
 *
 * 有意偏离酒馆处：matchWholeWords 仅对纯拉丁词启用边界正则——酒馆原版对 CJK
 * 同样套 `(?:^|\W)…(?:$|\W)`，而 CJK 字符本身属 \W，边界形同虚设（全词匹配失真），
 * 故 CJK 键一律 includes 匹配。
 */
import { describe, expect, it } from 'vitest';

import { matchEntry, matchKeys } from '../worldbook/match';
import type { ScanSettings } from '../worldbook/types';
import { BASE, makeEntry, makeEnv } from './worldbook-fixtures';

describe('matchKeys 纯函数（主键）', () => {
  const ENTRY = makeEntry({ uid: 1, key: ['龙'] });

  it('关键词命中：普通键出现在聊天文本中即命中，未命中返回 false', () => {
    expect(matchKeys(ENTRY, '一条火龙', BASE)).toBe(true);
    expect(matchKeys(ENTRY, '一只山羊', BASE)).toBe(false);
  });

  it('键数组任一命中即命中', () => {
    expect(matchKeys(makeEntry({ uid: 1, key: ['龙', '巨兽'] }), '那是巨兽', BASE)).toBe(true);
  });

  it('正则键：/…/flags 形式按 RegExp.test 匹配，优先于普通匹配', () => {
    expect(matchKeys(makeEntry({ uid: 1, key: ['/第\\d+章/'] }), '第12章 北境风暴', BASE)).toBe(true);
    expect(matchKeys(makeEntry({ uid: 1, key: ['/龙\\d/'] }), '龙', BASE)).toBe(false);
  });

  it('无效正则（未转义内嵌斜杠）：回退为普通文本匹配', () => {
    const entry = makeEntry({ uid: 1, key: ['/[unclosed/'] });
    expect(matchKeys(entry, '文中出现 /[unclosed/ 字样', BASE)).toBe(true);
    expect(matchKeys(entry, '不含该字样', BASE)).toBe(false);
  });

  it('键先过宏替换：{{char}} 展开后匹配；替换为空串不算命中', () => {
    const env = makeEnv();
    expect(matchKeys(makeEntry({ uid: 1, key: ['{{char}}之剑'] }), '传说中爱丽丝之剑出土了', BASE, env)).toBe(true);
    expect(matchKeys(makeEntry({ uid: 1, key: ['{{getvar::missing}}'] }), '任意文本', BASE, env)).toBe(false);
  });

  it('全词匹配（拉丁词）：concatenate 不命中 cat，独立词命中', () => {
    const entry = makeEntry({ uid: 1, key: ['cat'], matchWholeWords: true });
    expect(matchKeys(entry, 'concatenate words', BASE)).toBe(false);
    expect(matchKeys(entry, 'a cat! runs', BASE)).toBe(true);
  });

  it('全词匹配对 CJK 键不生效（有意偏离酒馆）：苹果汁 仍命中 苹果', () => {
    const entry = makeEntry({ uid: 1, key: ['苹果'], matchWholeWords: true });
    expect(matchKeys(entry, '苹果汁很好喝', BASE)).toBe(true);
  });

  it('大小写不敏感（默认）：Dragon 命中 dragon', () => {
    expect(matchKeys(makeEntry({ uid: 1, key: ['Dragon'] }), 'the dragon sleeps', BASE)).toBe(true);
  });

  it('大小写敏感（全局开启）：Dragon 不命中 dragon', () => {
    const settings: ScanSettings = { ...BASE, caseSensitive: true };
    expect(matchKeys(makeEntry({ uid: 1, key: ['Dragon'] }), 'the dragon sleeps', settings)).toBe(false);
  });

  it('条目级 caseSensitive/matchWholeWords 覆盖全局（null 继承全局）', () => {
    const settings: ScanSettings = { ...BASE, caseSensitive: true, matchWholeWords: true };
    expect(
      matchKeys(makeEntry({ uid: 1, key: ['Dragon'], caseSensitive: false }), 'the dragon sleeps', settings),
    ).toBe(true);
    expect(
      matchKeys(makeEntry({ uid: 1, key: ['Dragon'], caseSensitive: null }), 'the dragon sleeps', settings),
    ).toBe(false);
  });
});

describe('matchEntry：二级键四逻辑（selectiveLogic）', () => {
  const KEY = { uid: 1, key: ['主人'], keysecondary: ['管家', '女仆'], selective: true, content: 'x' };

  it('AND_ANY(0)：任一二级键命中才激活', () => {
    expect(matchEntry({ ...KEY, selectiveLogic: 0 }, '主人吩咐女仆', BASE)).toBe(true);
    expect(matchEntry({ ...KEY, selectiveLogic: 0 }, '主人独自饮酒', BASE)).toBe(false);
  });

  it('NOT_ALL(1)：任一二级键不命中即通过（酒馆语义：至少一个不匹配）', () => {
    expect(matchEntry({ ...KEY, selectiveLogic: 1 }, '主人独自饮酒', BASE)).toBe(true);
    expect(matchEntry({ ...KEY, selectiveLogic: 1 }, '主人吩咐管家和女仆', BASE)).toBe(false);
  });

  it('NOT_ANY(2)：全部二级键不命中才通过', () => {
    expect(matchEntry({ ...KEY, selectiveLogic: 2 }, '主人独自饮酒', BASE)).toBe(true);
    expect(matchEntry({ ...KEY, selectiveLogic: 2 }, '主人吩咐女仆', BASE)).toBe(false);
  });

  it('AND_ALL(3)：全部二级键命中才激活', () => {
    expect(matchEntry({ ...KEY, selectiveLogic: 3 }, '主人吩咐管家和女仆', BASE)).toBe(true);
    expect(matchEntry({ ...KEY, selectiveLogic: 3 }, '主人只带了女仆', BASE)).toBe(false);
  });

  it('无二级键：仅主键判定（selectiveLogic 不参与）', () => {
    const entry = makeEntry({ uid: 1, key: ['主人'], keysecondary: [], selective: true, selectiveLogic: 2 });
    expect(matchEntry(entry, '主人吩咐女仆', BASE)).toBe(true);
  });

  it('主键未命中时直接 false，不再看二级键；selective=false 忽略二级键', () => {
    const entry = makeEntry({ uid: 1, key: ['主人'], keysecondary: ['女仆'], selective: true, selectiveLogic: 2 });
    expect(matchEntry(entry, '女仆在场', BASE)).toBe(false);
    expect(matchEntry({ ...entry, selective: false }, '主人吩咐女仆', BASE)).toBe(true);
  });

  it('constant 条目恒 true；无键且非 constant 为 false', () => {
    expect(matchEntry(makeEntry({ uid: 1, key: [], constant: true }), '', BASE)).toBe(true);
    expect(matchEntry(makeEntry({ uid: 1, key: [] }), '任意', BASE)).toBe(false);
  });
});
