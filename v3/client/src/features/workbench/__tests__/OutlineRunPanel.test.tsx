/**
 * 按大纲写「本次生成几章」弹层（两端共用组件）测试：
 * 默认 3 章、可改章数、点开始回调带上限值。桌面 CommandBar 与手机 TextPane 都挂这个组件。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OutlineRunPanel from '../OutlineRunPanel';

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('OutlineRunPanel（用户反馈 2026-11-27：手机端按大纲写一次写满 12 章）', () => {
  it('默认填 3 章，点开始回调 3', () => {
    const onStart = vi.fn();
    act(() => root.render(<OutlineRunPanel onStart={onStart} />));
    const input = host.querySelector<HTMLInputElement>('[data-testid="outline-limit-input"]')!;
    expect(input.value).toBe('3');
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-testid="outline-start"]')!.click();
    });
    expect(onStart).toHaveBeenCalledWith(3);
  });

  it('可改章数；非法/超界收敛到 1–99', () => {
    const onStart = vi.fn();
    act(() => root.render(<OutlineRunPanel onStart={onStart} />));
    const input = host.querySelector<HTMLInputElement>('[data-testid="outline-limit-input"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const set = (v: string) =>
      act(() => {
        setter.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const start = () =>
      act(() => {
        host.querySelector<HTMLButtonElement>('[data-testid="outline-start"]')!.click();
      });
    set('5');
    start();
    expect(onStart).toHaveBeenCalledWith(5);
    set('0');
    start();
    expect(onStart).toHaveBeenLastCalledWith(1);
    set('999');
    start();
    expect(onStart).toHaveBeenLastCalledWith(99);
  });

  it('渲染桌面与手机共用的两个约定 testid', () => {
    act(() => root.render(<OutlineRunPanel onStart={() => undefined} />));
    expect(host.querySelector('[data-testid="outline-limit-input"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="outline-start"]')).not.toBeNull();
  });
});
