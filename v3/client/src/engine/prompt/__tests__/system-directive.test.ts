/**
 * 系统指令块剥离测试（联测问题 1/2 修复）：续写/重试指令被模型复述进正文时整块剥除。
 */
import { describe, expect, it } from 'vitest';

import { stripSystemDirectiveBlocks } from '../sanitize';

describe('stripSystemDirectiveBlocks（系统指令块剥离）', () => {
  it('完整闭合块：指令复述整块剥离，正文保留', () => {
    const raw =
      '（系统续写指令：从下面已写内容的结尾自然续写，保持行文连贯，不要重复已有文字；全程用简体中文思考和写作。本括号内是指令不是正文，禁止复述。）\n\n…第三章已写的结尾片段\n（系统续写指令结束）\n\n这才是真正的第三章正文。';
    const out = stripSystemDirectiveBlocks(raw);
    expect(out).toBe('这才是真正的第三章正文。');
    expect(out).not.toContain('续写');
  });

  it('未闭合块（模型只复述了开头标签）：剥到文尾', () => {
    const raw = '（系统重试指令：上一次输出只有思考没有正文……后面全是复述内容';
    const out = stripSystemDirectiveBlocks(raw);
    expect(out).toBe('');
  });

  it('无指令的干净正文原样保留', () => {
    const raw = '第一章正文。\n\n妹妹攥住他的衣角。';
    expect(stripSystemDirectiveBlocks(raw)).toBe(raw);
  });
});
