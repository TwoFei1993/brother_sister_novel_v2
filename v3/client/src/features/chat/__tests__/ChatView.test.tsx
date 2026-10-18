/**
 * ChatView 渲染测试（jsdom + createRoot，无 testing-library 依赖）
 * 覆盖：气泡方向与角色名 / 流式生成中气泡（§4.3 验收场景的激活角色）/ 发送回调 /
 * swipe 与重roll 回调。纯 props 组件，不触网。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@shared/message';

import ChatView, { type ChatViewProps } from '../ChatView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MEMBERS = [
  { id: 'gege', name: '哥哥' },
  { id: 'meimei', name: '妹妹' },
  { id: 'peijue', name: '配角' },
];

function msg(partial: Pick<Message, 'id' | 'role' | 'name' | 'content'> & Partial<Message>): Message {
  return { createdAt: 1, swipes: [partial.content], swipeId: 0, extra: {}, ...partial };
}

function baseProps(overrides: Partial<ChatViewProps> = {}): ChatViewProps {
  return {
    messages: [],
    members: MEMBERS,
    lastSpeakerId: null,
    manualPickId: null,
    onSend: vi.fn(),
    onPick: vi.fn(),
    ...overrides,
  };
}

const roots: Root[] = [];

async function renderView(props: ChatViewProps): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<ChatView {...props} />);
  });
  return container;
}

/** 受控输入赋值（React onChange 监听 input 事件） */
async function type(container: HTMLElement, selector: string, text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(container: HTMLElement, selector: string): Promise<void> {
  await act(async () => {
    container.querySelector(selector)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
});

describe('ChatView', () => {
  it('气泡方向与角色名：用户靠右、角色靠左带头像首字占位', async () => {
    const c = await renderView(
      baseProps({
        messages: [
          msg({ id: 'u1', role: 'user', name: '用户', content: '让妹妹说话' }),
          msg({ id: 'a1', role: 'assistant', name: '妹妹', content: '好呀，我来说～' }),
        ],
      }),
    );
    const user = c.querySelector('[data-side="right"]')!;
    expect(user.getAttribute('data-name')).toBe('用户');
    expect(user.textContent).toContain('让妹妹说话');
    const ai = c.querySelector('[data-side="left"]')!;
    expect(ai.getAttribute('data-name')).toBe('妹妹');
    expect(ai.textContent).toContain('好呀，我来说～');
    expect(ai.querySelector('[data-testid="chat-avatar"]')?.textContent).toBe('妹'); // 首字圆形头像占位
  });

  it('流式生成中气泡显示激活角色名（验收场景：lastSpeaker=哥哥、消息提及妹妹 → 妹妹）与缓冲文本', async () => {
    const c = await renderView(
      baseProps({
        lastSpeakerId: 'gege',
        streaming: true,
        buffer: '我来说两句',
        messages: [msg({ id: 'u1', role: 'user', name: '用户', content: '让妹妹说话' })],
      }),
    );
    const bubble = c.querySelector('[data-testid="chat-streaming-bubble"]')!;
    expect(bubble.textContent).toContain('妹妹');
    expect(bubble.textContent).toContain('我来说两句');
  });

  it('发送：回调携带整理后文本并清空输入；父层开始生成后刚发送文本以气泡暂存', async () => {
    const onSend = vi.fn();
    const props = baseProps({ onSend });
    const c = await renderView(props);
    await type(c, '[data-testid="chat-input"]', '  你好呀  ');
    await click(c, '[data-testid="chat-send"]');
    expect(onSend).toHaveBeenCalledWith('你好呀');
    expect(c.querySelector<HTMLInputElement>('[data-testid="chat-input"]')!.value).toBe('');
    // 父层收到 onSend 后开始生成（streaming=true 重渲染）→ pending 气泡接管展示
    await act(async () => {
      roots[0].render(<ChatView {...baseProps({ onSend, streaming: true, buffer: '' })} />);
    });
    expect(c.querySelector('[data-testid="chat-pending-bubble"]')?.textContent).toContain('你好呀');
    expect(c.querySelector('[data-testid="chat-streaming-bubble"]')).not.toBeNull();
  });

  it('AI 消息 swipe 切换与重roll 回调携带消息 id，多候选显示位置', async () => {
    const onSwipe = vi.fn();
    const onRegenerate = vi.fn();
    const c = await renderView(
      baseProps({
        messages: [msg({ id: 'a1', role: 'assistant', name: '妹妹', content: '候选一', swipes: ['候选一', '候选二'] })],
        onSwipe,
        onRegenerate,
      }),
    );
    expect(c.querySelector('[data-testid="swipe-position"]')?.textContent).toBe('1/2');
    await click(c, '[data-testid="swipe-right"]');
    expect(onSwipe).toHaveBeenCalledWith('a1', 1);
    await click(c, '[data-testid="swipe-left"]');
    expect(onSwipe).toHaveBeenCalledWith('a1', -1);
    await click(c, '[data-testid="regen-btn"]');
    expect(onRegenerate).toHaveBeenCalledWith('a1');
  });

  it('空消息流显示引导文案；生成中禁用输入', async () => {
    const c = await renderView(baseProps());
    expect(c.querySelector('[data-testid="chat-empty"]')?.textContent).toContain('开始对话');
    const c2 = await renderView(baseProps({ streaming: true }));
    expect((c2.querySelector('[data-testid="chat-input"]') as HTMLInputElement).disabled).toBe(true);
    expect((c2.querySelector('[data-testid="chat-send"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
