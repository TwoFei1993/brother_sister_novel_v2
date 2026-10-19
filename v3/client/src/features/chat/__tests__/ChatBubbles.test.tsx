/**
 * ChatBubbles 渲染测试（jsdom + createRoot，无 testing-library 依赖）
 * 覆盖审计 H1：assistant 气泡 markdown 渲染（粗体/分隔线/列表）+ 简化 prose 排版类
 * + 净化（script 剥离）+ 显示轨正则应用；用户气泡保持纯文本。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from '@shared/message';
import type { TavernRegexScript } from '@shared/tavern';

import { MessageBubble, UserBubble } from '../ChatBubbles';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function assistantMsg(content: string): Message {
  return {
    id: 'a1',
    role: 'assistant',
    name: '妹妹',
    content,
    createdAt: 1,
    swipes: [content],
    swipeId: 0,
    extra: {},
  };
}

/** markdownOnly + AI_OUTPUT 的显示轨脚本（§5.1②，渲染前改写、不污染入库正文） */
function displayScript(find: string, replace: string): TavernRegexScript {
  return {
    id: 's1',
    scriptName: '显示测试',
    findRegex: find,
    replaceString: replace,
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: 0,
    maxDepth: 9999,
  };
}

const roots: Root[] = [];

async function renderEl(ui: React.ReactElement): Promise<HTMLElement> {
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

/** assistant 气泡正文排版容器（rounded-2xl 内的 markdown 包装层） */
function markdownWrap(c: HTMLElement): HTMLElement {
  const el = c.querySelector('[data-testid="chat-bubble"] .rounded-2xl > div');
  if (!el) throw new Error('markdown 包装层缺失');
  return el as HTMLElement;
}

describe('ChatBubbles markdown 渲染（审计 H1）', () => {
  it('粗体与分隔线渲染为元素，** / --- 不再字面显示', async () => {
    const c = await renderEl(
      <MessageBubble message={assistantMsg('**重要提示**\n\n---\n\n正文')} canSwipe={false} canRegenerate={false} />,
    );
    const bubble = c.querySelector('[data-testid="chat-bubble"]')!;
    expect(bubble.querySelector('strong')?.textContent).toBe('重要提示');
    expect(bubble.querySelector('hr')).not.toBeNull();
    expect(bubble.textContent).not.toContain('**');
    expect(bubble.textContent).toContain('正文');
  });

  it('列表渲染 ul/li，排版容器带简化 prose 类（ps-5 缩进 + list-disc）', async () => {
    const c = await renderEl(
      <MessageBubble message={assistantMsg('- 第一条\n- 第二条')} canSwipe={false} canRegenerate={false} />,
    );
    expect(c.querySelectorAll('li').length).toBe(2);
    expect(markdownWrap(c).className).toContain('list-disc');
    expect(markdownWrap(c).className).toContain('ps-5');
  });

  it('script 注入被双层净化剥离，正文保留', async () => {
    const c = await renderEl(
      <MessageBubble message={assistantMsg('<script>window.hack=1</script>安全正文')} canSwipe={false} canRegenerate={false} />,
    );
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('[data-testid="chat-bubble"]')!.textContent).toContain('安全正文');
  });

  it('显示轨正则（markdownOnly）在渲染前应用，仅改显示不影响内容断言', async () => {
    const c = await renderEl(
      <MessageBubble
        message={assistantMsg('这里的隐藏词要被折叠')}
        canSwipe={false}
        canRegenerate={false}
        regexScripts={[displayScript('隐藏词', '替换词')]}
      />,
    );
    expect(c.querySelector('[data-testid="chat-bubble"]')!.textContent).toContain('替换词');
  });

  it('用户气泡保持纯文本：markdown 标记不渲染为元素', async () => {
    const c = await renderEl(<UserBubble name="用户" content="**这不是粗体**" />);
    expect(c.querySelector('strong')).toBeNull();
    expect(c.textContent).toContain('**这不是粗体**');
  });
});
