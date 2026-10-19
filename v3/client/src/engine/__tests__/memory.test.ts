/**
 * 记忆系统测试（设计 §5.3 滚动摘要）
 */
import { describe, expect, it } from 'vitest';

import type { Message } from '@shared/message';

import { buildSummarizePrompt, shouldSummarize } from '../prompt/novel/memory';

/** 构造 n 条带 chapter 元数据的 assistant 章节消息 */
function chapters(n: number): Message[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    role: 'assistant' as const,
    name: '爱丽丝',
    content: `第${i}章`,
    createdAt: i,
    swipes: [],
    swipeId: 0,
    chapter: { index: i, title: `第${i}章` },
    extra: {},
  }));
}

/** 构造 n 条无章节元数据的普通消息 */
function plain(n: number): Message[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    role: (i % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
    name: '爱丽丝',
    content: `普通消息${i}`,
    createdAt: i,
    swipes: [],
    swipeId: 0,
    extra: {},
  }));
}

describe('shouldSummarize', () => {
  it('assistant 章节消息数是 everyN 的正整数倍时触发', () => {
    expect(shouldSummarize(chapters(5), 5)).toBe(true);
    expect(shouldSummarize(chapters(10), 5)).toBe(true);
    expect(shouldSummarize(chapters(4), 5)).toBe(false);
    expect(shouldSummarize(chapters(0), 5)).toBe(false); // 0 章不触发
    expect(shouldSummarize(chapters(5), 0)).toBe(false); // everyN 非法不触发
    expect(shouldSummarize(chapters(3), 0)).toBe(false);
  });

  it('无 chapter 元数据的消息不计入章节数', () => {
    expect(shouldSummarize(plain(5), 5)).toBe(false);
    expect(shouldSummarize(plain(10), 5)).toBe(false);
    expect(shouldSummarize([...chapters(4), ...plain(6)], 5)).toBe(false); // 仍 4 章
    expect(shouldSummarize([...chapters(5), ...plain(3)], 5)).toBe(true); // 5 章触发
  });
});

describe('buildSummarizePrompt', () => {
  it('中文摘要指令：压缩前文、保留关系/伏笔/时间线、限制 500 字', () => {
    const { system, user } = buildSummarizePrompt('旧摘要内容', ['章节甲文本', '章节乙文本']);
    expect(system).toContain('摘要');
    expect(system).toContain('500');
    expect(system).toContain('人物关系');
    expect(system).toContain('伏笔');
    expect(system).toContain('时间线');
    expect(user).toContain('旧摘要内容');
    expect(user).toContain('章节甲文本');
    expect(user).toContain('章节乙文本');
  });

  it('无已有摘要（首轮）时 user 不含【已有摘要】段', () => {
    const { user } = buildSummarizePrompt('', ['唯一章节']);
    expect(user).not.toContain('【已有摘要】');
    expect(user).toContain('唯一章节');
  });
});
