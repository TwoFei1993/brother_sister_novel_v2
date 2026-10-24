/**
 * 指令历史取数回归（深度测试 D2）：novel 指令存在章节消息 directive 元数据，
 * 旧实现 filter role==='user' 导致 C 工作台指令历史永远为空。
 */
import { describe, expect, it } from 'vitest';

import { aiVersion, type Message } from '@shared/message';

import { directiveList } from '../bench/DirectiveHistory';

function chapterMsg(id: string, directive: string | undefined): Message {
  return {
    id,
    role: 'assistant',
    name: '小说家',
    content: '正文'.repeat(30),
    createdAt: 1700000000000,
    swipes: [aiVersion('正文'.repeat(30), 'v1')],
    swipeId: 0,
    chapter: { index: 1, title: '第一章' },
    ...(directive ? { directive } : {}),
  } as Message;
}

function userMsg(id: string, content: string): Message {
  return {
    id,
    role: 'user',
    content,
    createdAt: 1700000000001,
    swipes: [aiVersion(content, 'v1')],
    swipeId: 0,
  } as Message;
}

describe('directiveList', () => {
  it('novel 章节 directive 消息进入指令历史（核心回归）', () => {
    const msgs = [chapterMsg('a', '兄妹踏入遗迹'), chapterMsg('b', undefined), chapterMsg('c', '深入祭坛')];
    const list = directiveList(msgs);
    expect(list.map((m) => m.directive)).toEqual(['深入祭坛', '兄妹踏入遗迹']);
  });

  it('独立 user 消息（chat 场景）照常进入', () => {
    const list = directiveList([userMsg('u', '手动指令')]);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe('手动指令');
  });

  it('无指令时为空（空态提示）', () => {
    expect(directiveList([chapterMsg('a', undefined)])).toEqual([]);
  });
});
