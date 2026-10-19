/**
 * FieldHint 问号提示组件测试（jsdom + createRoot，模式同 Editors.test）
 * 覆盖：默认态渲染 ? 图标与 title；tapToExpand 点击展开/收起说明条。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import FieldHint from '../FieldHint';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function mountPlain(ui: React.ReactElement): Promise<HTMLElement> {
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

describe('FieldHint', () => {
  it('默认态：渲染 title 说明与无障碍文本，不渲染展开条', async () => {
    const c = await mountPlain(<FieldHint text="触发关键词说明" />);
    const holder = c.querySelector('span[title="触发关键词说明"]');
    expect(holder).not.toBeNull();
    expect(holder!.textContent).toContain('?');
    expect(holder!.textContent).toContain('触发关键词说明'); // sr-only
    expect(c.querySelector('[data-testid="field-hint-note"]')).toBeNull();
  });

  it('tapToExpand：点击展开说明条，再点收起', async () => {
    const c = await mountPlain(<FieldHint tapToExpand text="换一支：重新生成本章" />);
    expect(c.querySelector('[data-testid="field-hint-note"]')).toBeNull();

    const toggle = c.querySelector<HTMLButtonElement>('[data-testid="field-hint-toggle"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      toggle.click();
    });
    const note = c.querySelector('[data-testid="field-hint-note"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('换一支：重新生成本章');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="field-hint-toggle"]')!.click();
    });
    expect(c.querySelector('[data-testid="field-hint-note"]')).toBeNull();
  });
});
