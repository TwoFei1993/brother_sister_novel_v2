import { describe, expect, it } from 'vitest';

import { isTruncatedText } from '../truncation';

describe('isTruncatedText（截断检测）', () => {
  it('句中戛然而止 → true', () => {
    const text = '# 第1章 雨夜\n\n妹妹攥紧了哥哥的袖口，远处传来一声闷响，她猛地回头，看见那道黑影正朝他们逼近，手里还握着闪着冷光的';
    expect(isTruncatedText(text)).toBe(true);
  });

  it('以句号收尾 → false', () => {
    const text = '# 第1章 雨夜\n\n妹妹攥紧了哥哥的袖口。两人对视一眼，转身走进了雨夜深处。';
    expect(isTruncatedText(text)).toBe(false);
  });

  it('引号对白收尾 → false', () => {
    const text = '他停下脚步。「走吧，天要亮了。」';
    expect(isTruncatedText(text)).toBe(false);
  });

  it('过短正文一律 false（防误判）', () => {
    expect(isTruncatedText('短')).toBe(false);
    expect(isTruncatedText('')).toBe(false);
  });

  it('去掉首行标题后判定不受标题干扰（短正文仍 false）', () => {
    expect(isTruncatedText('# 第1章 标题\n短正文')).toBe(false);
  });
});
