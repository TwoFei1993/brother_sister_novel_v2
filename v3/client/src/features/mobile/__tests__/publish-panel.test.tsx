/**
 * 上架管理面板测试（安卓 app Phase1 核心业务）：
 * - 草稿态：开关只改本地草稿，不触发 PATCH
 * - 保存：只对 diff 章节 PATCH（跳章语义），publishedVersionId 写入章节元数据
 * - 保存后 store 内章节状态同步更新
 * patchMessage 模块级 mock，不触网。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiVersion, type Message } from '@shared/message';

import { patchMessage } from '../../../api/works';
import { useWorkStore } from '../../../stores/work';
import PublishPanel from '../create/PublishPanel';

vi.mock('../../../api/works', () => ({ patchMessage: vi.fn().mockResolvedValue({ ok: true }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

function chapterMsg(index: number, versions: number, publishedVersionId: string | null): Message {
  const createdAt = 1700000000000 + index;
  return {
    id: `m${index}`,
    role: 'assistant',
    name: '小说家',
    content: `第${index}章正文`,
    createdAt,
    swipes: Array.from({ length: versions }, (_, i) => aiVersion(`第${index}章 v${i + 1}`, `v${i + 1}`, createdAt + i)),
    swipeId: versions - 1,
    chapter: { index, title: `第${index}章`, ...(publishedVersionId === null ? {} : { publishedVersionId }) },
    extra: {},
  };
}

afterEach(async () => {
  await act(async () => {
    for (const r of roots) r.unmount();
  });
  for (const c of containers) c.remove();
  roots.length = 0;
  containers.length = 0;
  vi.clearAllMocks();
  useWorkStore.getState().reset();
});

async function renderPanel(chapters: Message[]): Promise<HTMLElement> {
  useWorkStore.setState({ work: { id: 'w1', title: '测', mode: 'novel', genre: 'hunhe', revision: 1, characterIds: [], worldbookIds: [], presetId: '', regexScriptIds: [], settings: undefined as never, voiceMap: {}, createdAt: 1, updatedAt: 1 } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(<PublishPanel chapters={chapters as never} onClose={() => undefined} />);
  });
  return container;
}

describe('PublishPanel 上架管理', () => {
  it('开关只改草稿不触网；保存只 PATCH diff 章节（跳章）', async () => {
    const chapters = [
      chapterMsg(1, 1, null), // 未上架 → 开
      chapterMsg(2, 1, null), // 保持未上架
      chapterMsg(3, 2, null), // 未上架 → 开
    ];
    const c = await renderPanel(chapters);

    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="publish-switch-1"]')?.click();
    });
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="publish-switch-3"]')?.click();
    });
    expect(vi.mocked(patchMessage)).not.toHaveBeenCalled(); // 草稿态不触网

    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="publish-save-btn"]')?.click();
    });
    expect(vi.mocked(patchMessage)).toHaveBeenCalledTimes(2); // 只有 1、3 章 diff
    const [, secondCall] = vi.mocked(patchMessage).mock.calls;
    expect(secondCall[0]).toBe('w1');
    const saved = secondCall[1] as Message;
    expect(saved.id).toBe('m3');
    expect(saved.chapter?.publishedVersionId).toBe((chapters[2].swipes as { id: string }[])[1].id); // 激活版本
    // store 内章节元数据同步
    const storeMsg = useWorkStore.getState().messages.find((m) => m.id === 'm3');
    expect(storeMsg?.chapter?.publishedVersionId).toBe(saved.chapter?.publishedVersionId);
  });

  it('已上架章开关回关 → 保存 PATCH publishedVersionId=null（下架）', async () => {
    const v1 = aiVersion('正文', 'v1');
    const chapters = [chapterMsg(1, 1, v1.id)];
    const c = await renderPanel(chapters);

    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="publish-switch-1"]')?.click();
    });
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="publish-save-btn"]')?.click();
    });
    expect(vi.mocked(patchMessage)).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(patchMessage).mock.calls[0][1] as Message;
    expect(saved.chapter?.publishedVersionId).toBeNull();
  });
});
