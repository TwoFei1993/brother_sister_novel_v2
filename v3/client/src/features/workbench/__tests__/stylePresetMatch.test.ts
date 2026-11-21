/**
 * stylePresetMatch 纯函数单测（设计共识 D2：匹配含预设名称；理由展示；三分组）
 */
import { describe, expect, it } from 'vitest';

import {
  buildStyleKeywords,
  groupPresets,
  matchReasons,
  tagMatches,
  type PresetLite,
} from '../stylePresetMatch';

const p = (id: string, name: string, tags?: string[]): PresetLite => ({ id, name, tags });

describe('tagMatches', () => {
  it('双向子串包含', () => {
    expect(tagMatches('治愈', ['温情治愈'])).toBe(true);
    expect(tagMatches('欢乐', ['番茄欢乐'])).toBe(true); // 名称当 tag 用（D2）
    expect(tagMatches('悬疑', ['治愈', '热血'])).toBe(false);
  });
});

describe('buildStyleKeywords', () => {
  it('题材+基调拆词+风格标签，过滤分隔符与空串', () => {
    const kw = buildStyleKeywords('都市异能', ['温情·治愈', '热血爽文'], 'fanqie'); // 第三参是枚举值，实现内部查 WRITING_STYLE_LABELS
    expect(kw).toContain('都市异能');
    expect(kw).toContain('温情'); // 「·」拆词
    expect(kw).toContain('治愈');
    expect(kw).toContain('热血爽文');
    expect(kw).toContain('番茄'); // 风格标签拆词
    expect(kw).not.toContain('');
  });
});

describe('matchReasons', () => {
  it('tag 命中返回 tag 理由', () => {
    expect(matchReasons('某预设', ['通用', '治愈'], ['温情治愈'])).toEqual(['治愈']);
  });
  it('名称命中返回名称理由（D2：欢乐向书配番茄欢乐）', () => {
    expect(matchReasons('番茄欢乐', [], ['欢乐'])).toContain('名称:番茄欢乐');
  });
  it('通用 tag 不算匹配理由（通用走常驻分组）', () => {
    expect(matchReasons('某预设', ['通用'], ['通用'])).toEqual([]);
  });
  it('不命中返回空数组', () => {
    expect(matchReasons('某预设', ['古风'], ['都市'])).toEqual([]);
  });
});

describe('groupPresets', () => {
  const presets = [
    p('a', '通用基础', ['通用']),
    p('b', '番茄欢乐', ['欢乐']),
    p('c', '古风正剧', ['古风']),
  ];
  it('三分组：通用/匹配/其余（分组纯结构性行为，勾选态不参与）', () => {
    const g = groupPresets(presets, ['欢乐']);
    expect(g.general.map((x) => x.id)).toEqual(['a']);
    expect(g.matched.map((x) => x.id)).toEqual(['b']);
    expect(g.others.map((x) => x.id)).toEqual(['c']);
  });
});
