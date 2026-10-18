/**
 * ReadingView 组件渲染测试（jsdom + createRoot，模式与 Bookshelf.test.tsx 一致）
 * 覆盖：章节分组渲染（标题锚点+正文，指令消息不进正文）/ XSS 净化端到端（§9.3）/
 *       流式呼吸块显示 buffer / 向上分页提示。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@shared/message';
import ReadingView, { chapterAnchorId } from '../ReadingView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function chapterMsg(id: string, index: number, title: string, content: string): Message {
  return {
    id,
    role: 'assistant',
    name: '小说家',
    content,
    createdAt: Date.now(),
    swipes: [content],
    swipeId: 0,
    chapter: { index, title },
    extra: {},
  };
}

const roots: Root[] = [];
const containers: HTMLElement[] = [];

async function renderView(props: Partial<Parameters<typeof ReadingView>[0]> = {}): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  const base: Parameters<typeof ReadingView>[0] = {
    messages: [],
    streaming: false,
    buffer: '',
    hasMore: false,
    loadingOlder: false,
    onNeedOlder: () => undefined,
    ...props,
  };
  await act(async () => {
    root.render(<ReadingView {...base} />);
  });
  return container;
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, value: 0, writable: true });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 500 });
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  containers.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ReadingView 章节分组', () => {
  it('按 chapter 元数据分组渲染章标题与正文，作者指令消息不进正文', async () => {
    const directive: Message = {
      id: 'd1',
      role: 'user',
      name: '作者',
      content: '写兄妹进入遗迹',
      createdAt: Date.now(),
      swipes: [],
      swipeId: 0,
      extra: {},
    };
    const container = await renderView({
      messages: [
        chapterMsg('c1', 1, '第1章 试炼之门', '晨光刺破云层。'),
        directive,
        chapterMsg('c2', 2, '第2章 幽蓝裂缝', '妹妹攥住他的衣角。'),
      ],
    });
    const text = container.textContent ?? '';
    expect(text).toContain('第1章 试炼之门');
    expect(text).toContain('晨光刺破云层。');
    expect(text).toContain('第2章 幽蓝裂缝');
    expect(text).toContain('妹妹攥住他的衣角。');
    expect(text).not.toContain('写兄妹进入遗迹'); // 指令不进 B 视图正文
    expect(document.getElementById(chapterAnchorId(1))).not.toBeNull();
    expect(document.getElementById(chapterAnchorId(2))).not.toBeNull();
  });

  it('章节乱序到达时按章号升序排列', async () => {
    const container = await renderView({
      messages: [chapterMsg('c2', 2, '第二章', '乙'), chapterMsg('c1', 1, '第一章', '甲')],
    });
    const headings = container.querySelectorAll('article h2');
    expect(headings[0].textContent).toBe('第一章');
    expect(headings[1].textContent).toBe('第二章');
  });
});

describe('ReadingView XSS 净化（§9.3）', () => {
  it('script 标签与 javascript: 链接在渲染输出中被清除', async () => {
    const container = await renderView({
      messages: [
        chapterMsg(
          'cx',
          1,
          '净化章',
          '正常段<script>alert(1)</script>尾部\n\n[xss](javascript:alert(1))\n\n<img src=x onerror="alert(2)">',
        ),
      ],
    });
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    const links = Array.from(container.querySelectorAll('a'));
    for (const a of links) expect(a.getAttribute('href')?.startsWith('javascript:')).not.toBe(true);
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.textContent).toContain('正常段'); // 正文不受净化影响
  });
});

describe('ReadingView 流式与分页', () => {
  it('生成中尾部呼吸块实时渲染 buffer', async () => {
    const container = await renderView({
      messages: [chapterMsg('c1', 1, '第一章', '已有内容')],
      streaming: true,
      buffer: '# 第2章 流式标题\n\n流式正文片段',
    });
    expect(container.textContent).toContain('正在生成');
    expect(container.textContent).toContain('流式正文片段');
  });

  it('hasMore 时提示向上加载更早章节', async () => {
    const container = await renderView({ hasMore: true });
    expect(container.textContent).toContain('向上滚动加载更早章节');
  });
});
