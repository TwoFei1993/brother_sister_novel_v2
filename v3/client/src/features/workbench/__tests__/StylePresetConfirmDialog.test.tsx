/**
 * 确认弹窗测试（设计共识 D3：三分组+理由；非通用必须经弹窗确认）
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StylePresetConfirmDialog from '../StylePresetConfirmDialog';
import type { PresetLite } from '../stylePresetMatch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const presets: PresetLite[] = [
  { id: 'a', name: '通用基础', tags: ['通用'] },
  { id: 'b', name: '番茄欢乐', tags: ['欢乐'] },
  { id: 'c', name: '古风正剧', tags: ['古风'] },
];

const roots: Root[] = [];

async function mount(draft: string[]): Promise<{ container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <StylePresetConfirmDialog
        presets={presets}
        draft={draft}
        keywords={['欢乐']}
        onConfirm={() => undefined}
        onClose={() => undefined}
      />,
    );
  });
  return { container };
}

function toggle(container: HTMLElement, id: string): Promise<void> {
  const box = container.querySelector<HTMLInputElement>(`input[data-preset-id="${id}"]`);
  if (!box) throw new Error(`missing checkbox ${id}`);
  return act(async () => {
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('StylePresetConfirmDialog', () => {
  afterEach(async () => {
    await act(async () => {
      for (const root of roots) root.unmount();
    });
    roots.length = 0;
    document.body.innerHTML = '';
  });

  it('三分组渲染：通用/匹配推荐（含理由）/其余', async () => {
    const { container } = await mount(['a', 'b']);
    expect(container.querySelector('[data-group="general"]')?.textContent).toContain('通用基础');
    const matched = container.querySelector('[data-group="matched"]');
    expect(matched?.textContent).toContain('番茄欢乐');
    expect(matched?.textContent).toContain('名称:番茄欢乐'); // 推荐理由展示
    expect(container.querySelector('[data-group="others"]')?.textContent).toContain('古风正剧');
  });

  it('弹窗内改勾选后确认，回传最终勾选列表', async () => {
    const onConfirm = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <StylePresetConfirmDialog
          presets={presets}
          draft={['a']}
          keywords={['欢乐']}
          onConfirm={onConfirm}
          onClose={() => undefined}
        />,
      );
    });
    await toggle(container, 'b'); // 勾上匹配推荐
    const ok = container.querySelector<HTMLButtonElement>('[data-testid="preset-confirm-ok"]');
    await act(async () => {
      ok!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onConfirm).toHaveBeenCalledWith(['a', 'b']);
  });
});
