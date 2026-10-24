/**
 * workStore.removeMessage 测试（深度测试 D3：删除本章）
 * 覆盖：乐观移除 + DELETE 持久化成功回拉 stats / 失败按 createdAt 序回插原位 / 无作品守卫。
 * API 层模块级 mock，不触网。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiVersion, type Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import { deleteMessage, getWork } from '../../api/works';
import { useWorkStore } from '../work';

vi.mock('../../api/works', () => ({
  deleteMessage: vi.fn(),
  getWork: vi.fn(),
  listMessages: vi.fn(),
  patchMessage: vi.fn(),
}));

const deleteMessageMock = vi.mocked(deleteMessage);
const getWorkMock = vi.mocked(getWork);

function msg(id: string, createdAt: number): Message {
  const content = `${id} 正文`;
  return {
    id,
    role: 'assistant',
    name: '小说家',
    content,
    createdAt,
    swipes: [aiVersion(content, 'v1', createdAt)],
    swipeId: 0,
    extra: {},
  };
}

/** 最小合法 Work（defaultNovelSettings 兜底设定，强类型无绕过） */
function fixtureWork(): Work {
  return {
    id: 'w1',
    title: '测试作品',
    mode: 'novel',
    genre: 'hunhe',
    revision: 1,
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
    stats: { messageCount: 3, chapterCount: 3, charCount: 100 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useWorkStore.setState({ work: fixtureWork(), messages: [msg('m1', 1), msg('m2', 2), msg('m3', 3)], hasMore: false });
});

describe('workStore.removeMessage（D3 删除本章）', () => {
  it('成功：乐观移除 + DELETE 持久化 + 回拉全量 Work 同步 stats，返回 true', async () => {
    const fresh = { ...fixtureWork(), revision: 2, stats: { messageCount: 2, chapterCount: 2, charCount: 80 } };
    getWorkMock.mockResolvedValue(fresh);
    deleteMessageMock.mockResolvedValue(undefined);

    const ok = await useWorkStore.getState().removeMessage('m2');

    expect(ok).toBe(true);
    expect(deleteMessageMock).toHaveBeenCalledWith('w1', 'm2');
    expect(useWorkStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(useWorkStore.getState().work?.stats?.chapterCount).toBe(2); // stats 快照已刷新
  });

  it('失败：DELETE 抛错 → 按 createdAt 序回插原位（不打乱消息流顺序），返回 false', async () => {
    deleteMessageMock.mockRejectedValue(new Error('网络中断'));

    const ok = await useWorkStore.getState().removeMessage('m2');

    expect(ok).toBe(false);
    expect(useWorkStore.getState().messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('无作品（work 未加载）直接 false，不发请求', async () => {
    useWorkStore.setState({ work: null });
    const ok = await useWorkStore.getState().removeMessage('m1');
    expect(ok).toBe(false);
    expect(deleteMessageMock).not.toHaveBeenCalled();
  });
});
