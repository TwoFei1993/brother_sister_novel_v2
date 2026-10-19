/**
 * 快速回复点选纯逻辑测试（用户反馈四问④）：
 * - isImplicitDirective：括号指令判定（隐式引导不入库）
 * - pickQuickDirectives：轮换窗口 / custom 池优先 / 空串过滤
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_QUICK_DIRECTIVES, QUICK_DIRECTIVE_COUNT, isImplicitDirective, pickQuickDirectives } from '../chat-directives';

describe('快速回复点选（四问④）', () => {
  it('隐式引导判定：中英文括号整条包裹为隐式，普通文本/局部括号非隐式', () => {
    expect(isImplicitDirective('（继续推进剧情）')).toBe(true);
    expect(isImplicitDirective('(走近对方)')).toBe(true);
    expect(isImplicitDirective(' （时间流逝到傍晚） ')).toBe(true); // 首尾空白容忍
    expect(isImplicitDirective('追问真相')).toBe(false);
    expect(isImplicitDirective('你觉得（那个）怎么样')).toBe(false); // 非整条包裹
    expect(isImplicitDirective('')).toBe(false);
  });

  it('轮换窗口：每轮换一组、数量恒为 5 且去重；custom 非空优先，全空串回退内置池', () => {
    const r0 = pickQuickDirectives(undefined, 0);
    const r1 = pickQuickDirectives(undefined, 1);
    expect(r0).toEqual(DEFAULT_QUICK_DIRECTIVES.slice(0, QUICK_DIRECTIVE_COUNT));
    expect(r0).not.toEqual(r1);
    expect(r1).toHaveLength(QUICK_DIRECTIVE_COUNT);
    expect(new Set(r1).size).toBe(QUICK_DIRECTIVE_COUNT);
    expect(pickQuickDirectives(undefined, DEFAULT_QUICK_DIRECTIVES.length)).toEqual(r0); // 取模回绕
    expect(pickQuickDirectives(['自定义A', '自定义B'], 1)).toEqual(['自定义B', '自定义A']);
    expect(pickQuickDirectives(['  ', ''], 0)).toEqual(r0);
    expect(DEFAULT_QUICK_DIRECTIVES.slice(0, 2).every((d) => isImplicitDirective(d))).toBe(true); // 前两条为隐式引导
  });
});
