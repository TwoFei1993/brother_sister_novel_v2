/**
 * 章节骨架注入测试（失忆兜底——摘要失败时被裁章节仍以标题+首段在场）
 */
import { describe, expect, it } from 'vitest';

import { aiVersion, type Message } from '@shared/message';

import { chapterSkeletonLine, skeletonBlock } from '../skeleton';

function chapterMsg(index: number, title: string, content: string): Message {
  return {
    id: `m${index}`,
    role: 'assistant',
    name: '小说家',
    content,
    createdAt: index,
    swipes: [aiVersion(content, 'v1')],
    swipeId: 0,
    chapter: { index, title },
    extra: {},
  };
}

describe('chapterSkeletonLine（单章骨架）', () => {
  it('书名号标题 + 首段截断', () => {
    const m = chapterMsg(1, '小票', '第一章正文开头。\n第二章内容另起一段。');
    expect(chapterSkeletonLine(m)).toBe('《小票》第一章正文开头。');
  });

  it('长首段截断加省略号', () => {
    const m = chapterMsg(1, '标题', `${'长'.repeat(150)}`);
    const line = chapterSkeletonLine(m);
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(160);
  });

  it('无标题 → 只有首段；content 非字符串 → 仅标题；都无 → 空串', () => {
    expect(chapterSkeletonLine({ ...chapterMsg(1, '', '正文内容。'), chapter: { index: 1, title: '' } })).toBe('正文内容。');
    expect(chapterSkeletonLine({ ...chapterMsg(1, '标题', 42 as unknown as string) })).toBe('《标题》');
    expect(chapterSkeletonLine({ ...chapterMsg(1, '', 42 as unknown as string), chapter: { index: 1, title: '' } })).toBe('');
  });
});

describe('skeletonBlock（注入块组装）', () => {
  it('dropped 章节列表 → 逐章「第N章《标题》首段」行 + 禁止复述警告头', () => {
    const dropped = [
      chapterMsg(1, '小票', '首章从一张小票开始。'),
      chapterMsg(2, '对手', '对手登场挑衅。'),
    ];
    const block = skeletonBlock(dropped);
    expect(block).toContain('【前文章节骨架');
    expect(block).toContain('第1章 《小票》首章从一张小票开始。');
    expect(block).toContain('第2章 《对手》对手登场挑衅。');
    expect(block).toContain('不得复述');
  });

  it('非章节消息（chat/指令）被过滤；空列表 → 空串不注入', () => {
    expect(skeletonBlock([])).toBe('');
    const chat: Message = {
      id: 'c1', role: 'user', name: '用户', content: '普通指令', createdAt: 1, swipes: [], swipeId: 0, extra: {},
    };
    expect(skeletonBlock([chat])).toBe('');
  });

  it('超过 20 章时更早章节只保留标题行（token 开销受控）', () => {
    const dropped = Array.from({ length: 25 }, (_, i) => chapterMsg(i + 1, `章${i + 1}`, `第${i + 1}章首段内容。`));
    const block = skeletonBlock(dropped);
    expect(block).toContain('第1章 《章1》'); // 最早 5 章仅标题
    expect(block).not.toContain('第1章首段内容'); // 无首段
    expect(block).toContain('第25章 《章25》第25章首段内容。'); // 最近 20 章含首段
  });
});
