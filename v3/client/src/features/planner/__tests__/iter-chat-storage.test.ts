/**
 * 迭代会话持久化测试（反馈：切分区回来对话丢失）
 * loadIterChat 空态 / save→load 往返 / 坏 JSON 容错 / lockedIndex 保形。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { loadIterChat, saveIterChat, type IterChatState } from '../iter-llm';

describe('OutlineIterChat 会话持久化（localStorage）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('无存储 → 空会话（history=[] locked=null）', () => {
    const s = loadIterChat('w1');
    expect(s.history).toEqual([]);
    expect(s.lockedIndex).toBeNull();
  });

  it('save→load 往返：对话与锁定章原样恢复（切分区卸载不丢）', () => {
    const state: IterChatState = {
      history: [
        { role: 'user', content: '第2章太平淡，结尾想要一个反转' },
        { role: 'assistant', content: '好的，反转落在谁身上？' },
      ],
      lockedIndex: 2,
    };
    saveIterChat('w1', state);
    const loaded = loadIterChat('w1');
    expect(loaded).toEqual(state);
  });

  it('坏 JSON 容错 → 空会话重建', () => {
    localStorage.setItem('v3-outline-iter-chat-w2', '{broken');
    const s = loadIterChat('w2');
    expect(s.history).toEqual([]);
    expect(s.lockedIndex).toBeNull();
  });

  it('旧数据缺 lockedIndex 字段 → 归一为 null（保形不炸）', () => {
    localStorage.setItem('v3-outline-iter-chat-w3', JSON.stringify({ history: [{ role: 'user', content: 'hi' }] }));
    const s = loadIterChat('w3');
    expect(s.lockedIndex).toBeNull();
    expect(s.history).toHaveLength(1);
  });
});
