/**
 * MemberBar 渲染测试（jsdom + createRoot，无 testing-library 依赖）
 * 覆盖：当前发言者高亮与「自动轮换/手动指定」标签态 / 点击手动指定与再点取消回调。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MemberBar, { type MemberBarProps } from '../MemberBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MEMBERS = [
  { id: 'gege', name: '哥哥' },
  { id: 'meimei', name: '妹妹' },
  { id: 'peijue', name: '配角' },
];

function baseProps(overrides: Partial<MemberBarProps> = {}): MemberBarProps {
  return {
    members: MEMBERS,
    lastSpeakerId: null,
    manualPickId: null,
    onPick: vi.fn(),
    ...overrides,
  };
}

const roots: Root[] = [];

async function renderBar(props: MemberBarProps): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<MemberBar {...props} />);
  });
  return container;
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

describe('MemberBar', () => {
  it('当前发言者（lastSpeaker）高亮，未手动指定时显示「自动轮换」标签', async () => {
    const c = await renderBar(baseProps({ lastSpeakerId: 'gege' }));
    expect(c.querySelector('[data-testid="member-mode-tag"]')?.textContent).toBe('自动轮换');
    expect(c.querySelector('[data-id="gege"]')?.getAttribute('data-picked')).toBe('true');
    expect(c.querySelector('[data-id="meimei"]')?.getAttribute('data-picked')).toBe('false');
    expect(c.querySelector('[data-id="gege"] [data-testid="member-avatar"]')?.textContent).toBe('哥'); // 首字占位
  });

  it('手动指定时高亮切换并显示「手动指定」标签', async () => {
    const c = await renderBar(baseProps({ lastSpeakerId: 'gege', manualPickId: 'peijue' }));
    expect(c.querySelector('[data-testid="member-mode-tag"]')?.textContent).toBe('手动指定');
    expect(c.querySelector('[data-id="peijue"]')?.getAttribute('data-picked')).toBe('true');
    expect(c.querySelector('[data-id="gege"]')?.getAttribute('data-picked')).toBe('false');
  });

  it('点击成员=手动指定（onPick(id)）；再点同成员=取消（onPick(null)）', async () => {
    const onPick = vi.fn();
    const c = await renderBar(baseProps({ onPick }));
    await click(c, '[data-id="meimei"]');
    expect(onPick).toHaveBeenNthCalledWith(1, 'meimei');
    // 父层更新 manualPickId='meimei' 后重渲染
    await act(async () => {
      roots[0].render(<MemberBar {...baseProps({ onPick, manualPickId: 'meimei' })} />);
    });
    await click(c, '[data-id="meimei"]');
    expect(onPick).toHaveBeenNthCalledWith(2, null);
  });

  it('生成中禁点成员', async () => {
    const c = await renderBar(baseProps({ streaming: true }));
    const item = c.querySelector<HTMLButtonElement>('[data-id="gege"]')!;
    expect(item.disabled).toBe(true);
  });
});
