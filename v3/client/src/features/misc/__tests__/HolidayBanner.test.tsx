/**
 * 节日横幅渲染测试（jsdom + createRoot，无 testing-library 依赖，与项目组件测试约定一致）
 * 覆盖：节日命中渲染 / 非节日不渲染 / 当日 dismiss 持久化。
 * 以 2026-02-17（春节，经验阳历表内日期）为样本日。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HolidayBanner, { getTodayHoliday } from '../HolidayBanner';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountBanner(): { root: Root; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<HolidayBanner />);
  });
  return { root, container };
}

function clickClose(container: HTMLElement): void {
  const btn = container.querySelector('button[aria-label="关闭节日横幅"]');
  if (!btn) throw new Error('missing close button');
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('HolidayBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('getTodayHoliday：春节样本日命中，普通日为 null', () => {
    expect(getTodayHoliday(new Date('2026-02-17T12:00:00'))?.name).toBe('春节');
    expect(getTodayHoliday(new Date('2026-03-10T12:00:00'))).toBeNull();
  });

  it('节日当天渲染问候语；非节日不渲染', () => {
    vi.setSystemTime(new Date('2026-02-17T12:00:00'));
    const first = mountBanner();
    expect(first.container.textContent).toContain('新春快乐！兄妹同贺岁');

    vi.setSystemTime(new Date('2026-03-10T12:00:00'));
    const second = mountBanner();
    expect(second.container.textContent).toBe('');
  });

  it('关闭后写入当日 dismiss；重新挂载不再出现', () => {
    vi.setSystemTime(new Date('2026-02-17T12:00:00'));
    const first = mountBanner();
    clickClose(first.container);
    expect(first.container.textContent).toBe('');
    expect(localStorage.getItem(`v3-holiday-dismissed_${new Date().toDateString()}`)).toBe('1');

    // 模拟刷新：新挂载应读取 dismiss 记录保持隐藏
    const second = mountBanner();
    expect(second.container.textContent).toBe('');
  });
});
