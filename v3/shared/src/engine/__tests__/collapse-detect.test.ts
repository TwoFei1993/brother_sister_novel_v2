import { describe, expect, it } from 'vitest';

import { isCollapsedText, maxRepeat4Gram } from '../prompt/novel/collapse-detect';

describe('重复循环崩溃检测 collapse-detect（深度测试实测退化形态）', () => {
  it('正常行文不误报（最高频 4-gram 为常用语，15-36 次）', () => {
    const normal = '他看了一眼门口，又看了一眼窗外。风把帘子吹起来，他看了一眼那盏没关的灯，起身走了过去。'.repeat(20);
    expect(isCollapsedText(normal)).toBe(false);
  });

  it('重复循环崩溃命中（单短语重复 ≥100 次）', () => {
    const text = '刀刀刀刀'.repeat(200); // 「刀刀刀刀」4-gram ×200（实测「刀——刀」×1331 同形态）
    expect(maxRepeat4Gram(text).n).toBeGreaterThanOrEqual(100);
    expect(isCollapsedText(text)).toBe(true);
  });

  it('真实崩溃样本形态：短语夹在叙述中重复上千次', () => {
    const text = '银的那一头闪着光。'.repeat(400); // 「银的那一」/「的那一头」各 ~399
    expect(isCollapsedText(text)).toBe(true);
    expect(maxRepeat4Gram(text).n).toBeGreaterThanOrEqual(300);
  });

  it('边界：短文本/空串安全', () => {
    expect(isCollapsedText('')).toBe(false);
    expect(isCollapsedText('短')).toBe(false);
    expect(maxRepeat4Gram('一二三').n).toBe(0);
  });

  it('阈值校准：刚好 99 次不报、100 次报（对照正常行文 ≤36 的实测分布）', () => {
    const text99 = '甲乙丙丁'.repeat(99);
    const text100 = '甲乙丙丁'.repeat(100);
    expect(isCollapsedText(text99)).toBe(false);
    expect(isCollapsedText(text100)).toBe(true);
  });
});
