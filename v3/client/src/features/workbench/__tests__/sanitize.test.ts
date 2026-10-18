/**
 * markdown 净化管道单测（设计 §9.3 XSS 双保险第一层：DOMPurify 源文本净化）
 * 渲染层（rehype-sanitize）兜底见 ReadingView.test.tsx 的 XSS 用例。
 */
import { describe, expect, it } from 'vitest';

import { sanitizeMarkdownSource } from '../sanitize';

describe('sanitizeMarkdownSource', () => {
  it('剥离 script 标签（含其内容）', () => {
    const out = sanitizeMarkdownSource('正文开头<script>alert(1)</script>正文结尾');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('正文开头');
    expect(out).toContain('正文结尾');
  });

  it('剥离事件属性（onerror/onclick/onload）', () => {
    const out = sanitizeMarkdownSource('<img src=x onerror="alert(2)"><a onclick="alert(3)">链接</a>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onclick');
  });

  it('剥离 style 与 iframe 高危标签', () => {
    const out = sanitizeMarkdownSource('<iframe src="https://evil.example"></iframe><style>*{}</style>ok');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<style');
    expect(out).toContain('ok');
  });

  it('正常 markdown 文本原样保留（不误伤）', () => {
    const src = '# 第1章 试炼\n\n**粗体**与`代码`，[链接](https://example.com)';
    expect(sanitizeMarkdownSource(src)).toBe(src);
  });

  it('幂等：净化结果再次净化不变', () => {
    const dirty = '<script>alert(1)</script>安全文本';
    const once = sanitizeMarkdownSource(dirty);
    expect(sanitizeMarkdownSource(once)).toBe(once);
  });
});
