import { describe, expect, it } from 'vitest';

import { createThinkSplitter } from '../think-split';

describe('createThinkSplitter（<think> 标签流式分流）', () => {
  it('无标签 → 全部进正文', () => {
    const s = createThinkSplitter();
    expect(s.split('普通正文')).toEqual({ content: '普通正文', thinking: '' });
    expect(s.flush()).toEqual({ content: '', thinking: '' });
  });

  it('完整 think 块 → 进思考流', () => {
    const s = createThinkSplitter();
    const r = s.split('前文<think>思路</think>后文');
    expect(r).toEqual({ content: '前文后文', thinking: '思路' });
  });

  it('标签跨 chunk 切成两半也能识别（半个标签留在未决缓冲）', () => {
    const s = createThinkSplitter();
    const a = s.split('正文<thi');
    expect(a).toEqual({ content: '正文', thinking: '' });
    const b = s.split('nk>思考中');
    expect(b).toEqual({ content: '', thinking: '思考中' });
  });

  it('未闭合的 think 块在流结束时归思考流（flush）', () => {
    const s = createThinkSplitter();
    const r = s.split('前文<think>只写了一半的思路');
    expect(r.content).toBe('前文');
    const f = s.flush();
    expect(f).toEqual({ content: '', thinking: '' });
  });

  it('多段交替 think 块各归各桶', () => {
    const s = createThinkSplitter();
    const r = s.split('<think>想1</think>正文1<think>想2</think>正文2');
    expect(r.content).toBe('正文1正文2');
    expect(r.thinking).toBe('想1想2');
  });

  it('flush 后可继续复用（状态复位，新一章从头开始）', () => {
    const s = createThinkSplitter();
    s.split('<think>旧的');
    s.flush();
    const r = s.split('新正文');
    expect(r).toEqual({ content: '新正文', thinking: '' });
  });
});
