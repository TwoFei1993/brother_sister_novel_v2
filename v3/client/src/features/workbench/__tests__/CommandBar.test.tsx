/**
 * CommandBar 组件状态测试（jsdom + createRoot）
 * 覆盖：非生成态（▶续写/⚡连写/📖按大纲/🎲换一支/◀▶候选切换）/ 生成态（⏹停止+进度）/ partialKept「继续」。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CommandBar from '../CommandBar';
import { useGenerationStore } from '../../../stores/generation';

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
    canOutline: false,
    onGenerate: () => undefined,
    onBatch: () => undefined,
    onByOutline: () => undefined,
    onToggleSwipe: () => undefined,
    onRerollLast: () => undefined,
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

  it('📖按大纲生成（反馈⑤）：canOutline=true 显示按钮，点击回调 onByOutline', async () => {
    const onByOutline = vi.fn();
    const c = await renderBar({ canOutline: true, onByOutline });
    const btn = c.querySelector<HTMLButtonElement>('[data-testid="outline-btn"]');
    expect(btn?.textContent).toContain('按大纲生成');
    // 点击 📖 展开选择面板（不直接发起）
    await act(async () => {
      btn!.click();
    });
    expect(c.querySelector('[data-testid="outline-panel"]')).not.toBeNull();
    expect(onByOutline).not.toHaveBeenCalled();

    // 面板内改章数 → 开始 → onByOutline 收到所选 limit（React 受控输入需原生 setter）
    const input = c.querySelector<HTMLInputElement>('[data-testid="outline-limit-input"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(input, '5');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="outline-start"]')!.click();
    });
    expect(onByOutline).toHaveBeenCalledWith(5);
    expect(c.querySelector('[data-testid="outline-panel"]')).toBeNull();
  });

  it('无大纲（canOutline=false）不渲染 📖 按钮', async () => {
    const c = await renderBar({ canOutline: false });
    expect(c.querySelector('[data-testid="outline-btn"]')).toBeNull();
  });

  it('按大纲生成中：停止按钮显示大纲进度（⏹ 停止 按大纲 2/7）', async () => {
    const c = await renderBar({ streaming: true, batchProgress: '按大纲 2/7' });
    expect(c.querySelector('[data-testid="stop-btn"]')?.textContent).toContain('按大纲 2/7');
    expect(c.querySelector('[data-testid="outline-btn"]')).toBeNull(); // 生成态非生成区整体隐藏
  });

  it('移动端折行布局（审计 H2）：容器 flex-wrap，输入框 basis-full 独占一行 / md 起回落同行', async () => {
    const c = await renderBar();
    const row = c.querySelector('div.flex-wrap');
    expect(row).not.toBeNull();
    const input = c.querySelector('[data-testid="directive-input"]')!;
    expect(input.className).toContain('basis-full'); // 移动端整行，按钮组换行
    expect(input.className).toContain('md:basis-0'); // 桌面恢复 flex 同行
    expect(input.className).toContain('min-w-32'); // 最差情况仍可输入
  });
});

describe('生成中思考指示（推理模型思考期可视化，滚动显示思考尾部）', () => {
  it('streaming 且 thinkingBuffer 非空 → 指示条含 💭 与思考尾部文本', async () => {
    useGenerationStore.setState({ streaming: true, thinkingBuffer: '思路'.repeat(700) });
    const c = await renderBar({ streaming: true });
    const ind = c.querySelector('[data-testid="thinking-indicator"]');
    expect(ind?.textContent).toContain('💭');
    expect(ind?.textContent).toContain('思路');
    useGenerationStore.setState({ streaming: false, thinkingBuffer: '' });
  });

  it('无思考流（thinkingBuffer 空）→ 不显示指示', async () => {
    useGenerationStore.setState({ streaming: true, thinkingBuffer: '' });
    const c = await renderBar({ streaming: true });
    expect(c.querySelector('[data-testid="thinking-indicator"]')).toBeNull();
    useGenerationStore.setState({ streaming: false, thinkingBuffer: '' });
  });
});
