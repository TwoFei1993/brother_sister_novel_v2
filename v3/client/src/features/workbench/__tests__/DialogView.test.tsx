/**
 * DialogView 组件渲染测试（jsdom + createRoot，模式与 ReadingView.test.tsx 一致）
 * 覆盖：指令气泡（右灰窄）/ 章节气泡（章标题+正文，指令消息不重复渲染正文）/
 *       SwipeBar ◀▶ 回调携带 messageId / 指令重放（编辑 directive 后回调）/ 尾部流式气泡。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@shared/message';
import DialogView from '../dialog/DialogView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function chapterMsg(overrides: Partial<Message> = {}): Message {
  const content = '第一章正文内容';
  return {
    id: 'm1',
    role: 'assistant',
    name: '小说家',
    content,
    createdAt: Date.now(),
    swipes: [content],
    swipeId: 0,
    chapter: { index: 1, title: '第一章 起点' },
    directive: '写一个开头',
    extra: {},
    ...overrides,
  };
}

const roots: Root[] = [];
const containers: HTMLElement[] = [];

interface RenderOpts {
  messages?: Message[];
  streaming?: boolean;
  buffer?: string;
  targetMessageId?: string | null;
}

async function renderView(opts: RenderOpts = {}): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(
      <DialogView
        messages={opts.messages ?? []}
        streaming={opts.streaming ?? false}
        buffer={opts.buffer ?? ''}
        targetMessageId={opts.targetMessageId ?? null}
        hasMore={false}
        loadingOlder={false}
        onNeedOlder={() => undefined}
        onSwipe={() => undefined}
        onReroll={() => undefined}
        onEditContent={async () => undefined}
        onReplay={() => undefined}
      />,
    );
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
    for (const r of roots) r.unmount();
  });
  for (const c of containers) c.remove();
  roots.length = 0;
  containers.length = 0;
  vi.restoreAllMocks();
});

describe('DialogView 气泡流', () => {
  it('指令气泡与章节气泡分列渲染：指令=directive 文本，章节=章标题+正文', async () => {
    const c = await renderView({ messages: [chapterMsg()] });
    expect(c.querySelector('[data-testid="directive-bubble"]')?.textContent).toContain('写一个开头');
    expect(c.querySelector('[data-testid="chapter-title"]')?.textContent).toContain('第一章 起点');
    expect(c.querySelector('[data-testid="chapter-bubble"]')?.textContent).toContain('第一章正文内容');
  });

  it('无 directive 的章节不渲染指令气泡；多候选显示 ◀ n/m ▶', async () => {
    const content = '第二支内容';
    const c = await renderView({
      messages: [chapterMsg({ directive: undefined, swipes: ['第一支', content], swipeId: 1, content })],
    });
    expect(c.querySelector('[data-testid="directive-bubble"]')).toBeNull();
    expect(c.querySelector('[data-testid="swipe-count"]')?.textContent).toBe('2/2');
  });

  it('◀▶ 回调携带消息 id 与 delta', async () => {
    const onSwipe = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);
    await act(async () => {
      root.render(
        <DialogView
          messages={[chapterMsg({ swipes: ['a', 'b'], swipeId: 0, content: 'a' })]}
          streaming={false}
          buffer=""
          targetMessageId={null}
          hasMore={false}
          loadingOlder={false}
          onNeedOlder={() => undefined}
          onSwipe={onSwipe}
          onReroll={() => undefined}
          onEditContent={async () => undefined}
          onReplay={() => undefined}
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="swipe-right"]')?.click();
      container.querySelector<HTMLButtonElement>('[data-testid="swipe-left"]')?.click();
    });
    expect(onSwipe).toHaveBeenNthCalledWith(1, 'm1', 1);
    expect(onSwipe).toHaveBeenNthCalledWith(2, 'm1', -1);
  });

  it('指令重放：点重放展开编辑框，改文本确认后回调 (message, 新指令)', async () => {
    const onReplay = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    containers.push(container);
    await act(async () => {
      root.render(
        <DialogView
          messages={[chapterMsg()]}
          streaming={false}
          buffer=""
          targetMessageId={null}
          hasMore={false}
          loadingOlder={false}
          onNeedOlder={() => undefined}
          onSwipe={() => undefined}
          onReroll={() => undefined}
          onEditContent={async () => undefined}
          onReplay={onReplay}
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="replay-btn"]')?.click();
    });
    const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="directive-editor"]');
    expect(editor?.value).toBe('写一个开头');
    await act(async () => {
      // React 受控 textarea：需绕过 value tracker 用原生 setter 触发 onChange
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(editor, '换成雨夜码头开头');
      editor!.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector<HTMLButtonElement>('[data-testid="directive-confirm"]')?.click();
    });
    expect(onReplay).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), '换成雨夜码头开头');
  });

  it('新章节生成中：目标 id 不在消息流 → 尾部实时 buffer 气泡；重生成 → 气泡内预览', async () => {
    const tail = await renderView({
      messages: [chapterMsg()],
      streaming: true,
      buffer: '流式新增内容',
      targetMessageId: 'new-uuid',
    });
    expect(tail.querySelector('[data-testid="tail-stream-bubble"]')?.textContent).toContain('流式新增内容');
    expect(tail.querySelector('[data-testid="buffer-preview"]')).toBeNull();

    const inner = await renderView({
      messages: [chapterMsg()],
      streaming: true,
      buffer: '重写预览',
      targetMessageId: 'm1',
    });
    expect(inner.querySelector('[data-testid="buffer-preview"]')?.textContent).toContain('重写预览');
    expect(inner.querySelector('[data-testid="tail-stream-bubble"]')).toBeNull();
  });
});
