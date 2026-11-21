/**
 * 确认弹窗测试（设计共识 D3：三分组+理由；非通用必须经弹窗确认）
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import StylePresetConfirmDialog from '../StylePresetConfirmDialog';
import type { PresetLite } from '../stylePresetMatch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const presets: PresetLite[] = [
  { id: 'a', name: '通用基础', tags: ['通用'] },
  { id: 'b', name: '番茄欢乐', tags: ['欢乐'] },
  { id: 'c', name: '古风正剧', tags: ['古风'] },
];

const roots: Root[] = [];

interface MountOpts {
  draft: string[];
  onConfirm?: (picked: string[]) => void;
  onClose?: () => void;
}

async function mount({ draft, onConfirm = () => undefined, onClose = () => undefined }: MountOpts): Promise<{ container: HTMLElement }> {
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
        onConfirm={onConfirm}
        onClose={onClose}
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

async function click(container: HTMLElement, testId: string): Promise<void> {
  const el = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`missing [data-testid="${testId}"]`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
    const { container } = await mount({ draft: ['a', 'b'] });
    expect(container.querySelector('[data-group="general"]')?.textContent).toContain('通用基础');
    const matched = container.querySelector('[data-group="matched"]');
    expect(matched?.textContent).toContain('番茄欢乐');
    expect(matched?.textContent).toContain('名称:番茄欢乐'); // 推荐理由展示
    expect(container.querySelector('[data-group="others"]')?.textContent).toContain('古风正剧');
  });

  it('弹窗内改勾选后确认，回传最终勾选列表', async () => {
    const onConfirm = vi.fn();
    const { container } = await mount({ draft: ['a'], onConfirm });
    await toggle(container, 'b'); // 勾上匹配推荐
    await click(container, 'preset-confirm-ok');
    expect(onConfirm).toHaveBeenCalledWith(['a', 'b']);
  });

  it('反选方向：已勾选再点取消勾选，确认回传不含它的列表', async () => {
    const onConfirm = vi.fn();
    const { container } = await mount({ draft: ['a', 'b'], onConfirm });
    await toggle(container, 'b'); // 反选去掉 b（filter 分支）
    await click(container, 'preset-confirm-ok');
    expect(onConfirm).toHaveBeenCalledWith(['a']);
  });

  it('取消按钮与点遮罩背景均触发 onClose', async () => {
    const onClose = vi.fn();
    const { container } = await mount({ draft: ['a'], onClose });
    await click(container, 'preset-confirm-cancel');
    expect(onClose).toHaveBeenCalledTimes(1);
    const mask = container.querySelector('[data-testid="preset-confirm-dialog"]');
    await act(async () => {
      mask!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Escape 键关闭弹窗', async () => {
    const onClose = vi.fn();
    const { container } = await mount({ draft: ['a'], onClose });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
