/**
 * 英文句剥离测试（联测问题 2 修复）：推理模型英文自我纠错渗入正文的句子整句剥除。
 */
import { describe, expect, it } from 'vitest';

import { stripEnglishSentences } from '../sanitize';

describe('stripEnglishSentences（英文句安全网）', () => {
  it('正文中间的英文自我纠错句剥除，前后中文保留', () => {
    const raw =
      '沈清晏三岁这年春天，镇国公府换了乳母。 Wait I need to stop and correct this approach. 她抬头看向窗外。';
    const out = stripEnglishSentences(raw);
    expect(out).not.toContain('Wait');
    expect(out).toContain('沈清晏三岁这年春天');
    expect(out).toContain('她抬头看向窗外');
  });

  it('连续多句英文独白全部剥除', () => {
    const raw = '中文开头。 This is wrong. I should rewrite it now. 中文结尾。';
    const out = stripEnglishSentences(raw);
    expect(out).toContain('中文开头。');
    expect(out).toContain('中文结尾。');
    expect(out).not.toContain('This is wrong');
  });

  it('正常中文句子（含少量英文夹杂如 AI）不受影响', () => {
    const raw = '她打开了 AI 助手，屏幕亮起。这是一段完全正常的中文叙述，不应被误删。';
    expect(stripEnglishSentences(raw)).toBe(raw);
  });

  it('无英文的纯中文原样返回', () => {
    const raw = '第一章正文。\n\n妹妹攥住他的衣角。';
    expect(stripEnglishSentences(raw)).toBe(raw);
  });
});
