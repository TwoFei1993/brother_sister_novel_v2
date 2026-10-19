/**
 * CommandBar 组件状态测试（jsdom + createRoot）
 * 覆盖：非生成态（▶续写/🎲换一支/◀▶候选切换）/ 生成态（⏹停止）/ partialKept「继续」。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CommandBar from '../CommandBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function renderBar(props: Partial<Parameters<typeof CommandBar>[0]> = {}): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const base: Parameters<typeof CommandBar>[0] = {
    streaming: false,
    partialKept: false,
    canToggleSwipe: false,
    swipePosition: null,
    disabled: false,
    busy: false,
    batchProgress: null,
    onGenerate: () => undefined,
    onBatch: () => undefined,
    onToggleSwipe: () => undefined,
    onContinue: () => undefined,
    onStop: () => undefined,
    ...props,
  };
  await act(async () => {
    root.render(<CommandBar {...base} />);
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

describe('CommandBar 状态', () => {
  it('非生成态：显示指令输入/▶续写/🎲换一支，不显示停止与继续', async () => {
    const c = await renderBar();
    expect(c.querySelector('[data-testid="directive-input"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="generate-btn"]')?.textContent).toContain('续写');
    expect(c.querySelector('[data-testid="swipe-btn"]')?.textContent).toContain('换一支');
    expect(c.querySelector('[data-testid="stop-btn"]')).toBeNull();
    expect(c.querySelector('[data-testid="continue-btn"]')).toBeNull();
  });

  it('多候选时显示 ◀▶ 切换与位置（2/3），隐藏 🎲', async () => {
    const c = await renderBar({ canToggleSwipe: true, swipePosition: '2/3' });
    expect(c.querySelector('[data-testid="swipe-position"]')?.textContent).toBe('2/3');
    expect(c.querySelector('[data-testid="swipe-btn"]')).toBeNull();
  });

  it('生成中：▶变⏹停止，输入隐藏', async () => {
    const c = await renderBar({ streaming: true });
    expect(c.querySelector('[data-testid="stop-btn"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="generate-btn"]')).toBeNull();
    expect(c.querySelector('[data-testid="directive-input"]')).toBeNull();
  });

  it('partialKept：停止后显示「继续」', async () => {
    const c = await renderBar({ partialKept: true });
    expect(c.querySelector('[data-testid="continue-btn"]')?.textContent).toContain('继续');
  });

  it('点击▶续写：携带指令回调并清空输入', async () => {
    const onGenerate = vi.fn();
    const c = await renderBar({ onGenerate });
    const input = c.querySelector<HTMLInputElement>('[data-testid="directive-input"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, '兄妹进入遗迹');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onGenerate).toHaveBeenCalledWith('兄妹进入遗迹');
    expect(input!.value).toBe('');
  });

  it('⚡连写：携带指令回调 onBatch 并清空输入', async () => {
    const onBatch = vi.fn();
    const c = await renderBar({ onBatch });
    const input = c.querySelector<HTMLInputElement>('[data-testid="directive-input"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, '兄妹进入城堡');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="batch-btn"]')!.click();
    });
    expect(onBatch).toHaveBeenCalledWith('兄妹进入城堡');
    expect(input!.value).toBe('');
  });

  it('连写中：停止按钮显示进度（⏹ 停止 3/50）', async () => {
    const c = await renderBar({ streaming: true, batchProgress: '3/50' });
    expect(c.querySelector('[data-testid="stop-btn"]')?.textContent).toContain('3/50');
  });
});
