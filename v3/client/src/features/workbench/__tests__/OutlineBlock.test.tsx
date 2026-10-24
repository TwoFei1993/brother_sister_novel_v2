/**
 * 提纲折叠展示渲染测试（splitOutline 接线：ReadingView B 视图 / MessageBubble A 视图）
 * 覆盖：有提纲 → 折叠条显示且收起态正文不含提纲文本（点击展开后可见）；
 *       无提纲 → 不渲染折叠条、正文原样。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { aiVersion, type Message } from '@shared/message';
import MessageBubble from '../dialog/MessageBubble';
import ReadingView from '../ReadingView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 带头部要点提纲的章节正文（splitOutline 可分离的列表式提纲） */
const OUTLINE_CONTENT =
  '**本章要点**\n- 林枫在便利店发现异响\n- 神秘店员现身\n- 结尾留下悬念\n\n天蒙蒙亮的时候，林枫被一阵急促的脚步声惊醒。他几乎是本能地从床上弹起，抓起了桌上的手电筒。';
/** 无提纲的纯正文 */
const PLAIN_CONTENT =
  '雨点砸在窗棂上，她攥紧了那半块玉佩。这是父亲留下的唯一遗物，也是她必须带出这座城的东西。';

function chapterMsg(id: string, index: number, title: string, content: string): Message {
  return {
    id,
    role: 'assistant',
    name: '小说家',
    content,
    createdAt: Date.now(),
    swipes: [aiVersion(content, 'v1')],
    swipeId: 0,
    chapter: { index, title },
    extra: {},
  };
}

const roots: Root[] = [];

async function render(ui: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(ui);
  });
  return container;
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
});

describe('提纲折叠（B 视图 ReadingView）', () => {
  it('有提纲：显示折叠条且收起态正文不含提纲文本，点击展开后可见', async () => {
    const container = await render(
      <ReadingView
        messages={[chapterMsg('c1', 1, '第1章 便利店谜影', OUTLINE_CONTENT)]}
        streaming={false}
        buffer=""
        hasMore={false}
        loadingOlder={false}
        onNeedOlder={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="outline-block"]')).not.toBeNull();
    expect(container.textContent).toContain('本章要点提纲');
    // 收起态：提纲条目不渲染进正文
    expect(container.textContent).not.toContain('神秘店员现身');
    expect(container.textContent).toContain('天蒙蒙亮的时候'); // 正文正常显示
    // 点击展开：提纲文本可见；再点收起：再次隐藏
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="outline-toggle"]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      toggle?.click();
    });
    expect(container.textContent).toContain('神秘店员现身');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      toggle?.click();
    });
    expect(container.textContent).not.toContain('神秘店员现身');
  });

  it('无提纲：不渲染折叠条，正文原样显示', async () => {
    const container = await render(
      <ReadingView
        messages={[chapterMsg('c2', 1, '第1章', PLAIN_CONTENT)]}
        streaming={false}
        buffer=""
        hasMore={false}
        loadingOlder={false}
        onNeedOlder={() => undefined}
      />,
    );
    expect(container.querySelector('[data-testid="outline-block"]')).toBeNull();
    expect(container.textContent).toContain('雨点砸在窗棂上');
  });
});

describe('提纲折叠（A 视图 MessageBubble）', () => {
  it('章节气泡显示折叠条，收起态正文不含提纲文本', async () => {
    const container = await render(
      <MessageBubble message={chapterMsg('c3', 1, '第1章', OUTLINE_CONTENT)} streaming={false} />,
    );
    expect(container.querySelector('[data-testid="outline-block"]')).not.toBeNull();
    expect(container.textContent).not.toContain('神秘店员现身');
    expect(container.textContent).toContain('抓起了桌上的手电筒');
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="outline-toggle"]')?.click();
    });
    expect(container.textContent).toContain('神秘店员现身');
  });

  it('无提纲：气泡不渲染折叠条', async () => {
    const container = await render(
      <MessageBubble message={chapterMsg('c4', 1, '第1章', PLAIN_CONTENT)} streaming={false} />,
    );
    expect(container.querySelector('[data-testid="outline-block"]')).toBeNull();
  });
});
