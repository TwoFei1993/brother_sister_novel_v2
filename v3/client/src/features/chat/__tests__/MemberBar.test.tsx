/**
 * MemberBar 渲染测试（jsdom + createRoot，无 testing-library 依赖）
 * 覆盖：轮换提示「下一位/已指定」标签态 / 点击手动指定与再点取消回调 /
 * 回复长度三档切换 / 自动连播开关 / 生成中禁点。
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
    nextSpeakerName: '哥哥',
    replyLength: 'medium',
    onReplyLengthChange: vi.fn(),
    autoPlay: false,
    onAutoPlayToggle: vi.fn(),
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
  it('当前发言者（lastSpeaker）高亮，未手动指定时显示「下一位：XX」轮换提示', async () => {
    const c = await renderBar(baseProps({ lastSpeakerId: 'gege', nextSpeakerName: '妹妹' }));
    expect(c.querySelector('[data-testid="member-mode-tag"]')?.textContent).toBe('下一位：妹妹');
    expect(c.querySelector('[data-id="gege"]')?.getAttribute('data-picked')).toBe('true');
    expect(c.querySelector('[data-id="meimei"]')?.getAttribute('data-picked')).toBe('false');
    expect(c.querySelector('[data-id="gege"] [data-testid="member-avatar"]')?.textContent).toBe('哥'); // 首字占位
  });

  it('手动指定时显示「已指定：XX」并高亮切换', async () => {
    const c = await renderBar(baseProps({ lastSpeakerId: 'gege', manualPickId: 'peijue', nextSpeakerName: '配角' }));
    expect(c.querySelector('[data-testid="member-mode-tag"]')?.textContent).toBe('已指定：配角');
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

  it('长度三档：当前档高亮，点击回调对应档位', async () => {
    const onReplyLengthChange = vi.fn();
    const c = await renderBar(baseProps({ replyLength: 'medium', onReplyLengthChange }));
    expect(c.querySelector('[data-testid="reply-length-medium"]')?.getAttribute('data-active')).toBe('true');
    expect(c.querySelector('[data-testid="reply-length-long"]')?.getAttribute('data-active')).toBe('false');
    await click(c, '[data-testid="reply-length-long"]');
    expect(onReplyLengthChange).toHaveBeenCalledWith('long');
  });

  it('自动连播开关：aria-pressed 反映状态，点击回调切换', async () => {
    const onAutoPlayToggle = vi.fn();
    const c = await renderBar(baseProps({ autoPlay: false, onAutoPlayToggle }));
    const btn = c.querySelector('[data-testid="auto-play-toggle"]')!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    await click(c, '[data-testid="auto-play-toggle"]');
    expect(onAutoPlayToggle).toHaveBeenCalledTimes(1);
    await act(async () => {
      roots[0].render(<MemberBar {...baseProps({ autoPlay: true, onAutoPlayToggle })} />);
    });
    expect(c.querySelector('[data-testid="auto-play-toggle"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('生成中禁点成员、长度档与自动开关', async () => {
    const c = await renderBar(baseProps({ streaming: true }));
    expect(c.querySelector<HTMLButtonElement>('[data-id="gege"]')!.disabled).toBe(true);
    expect(c.querySelector<HTMLButtonElement>('[data-testid="reply-length-short"]')!.disabled).toBe(true);
    expect(c.querySelector<HTMLButtonElement>('[data-testid="auto-play-toggle"]')!.disabled).toBe(true);
  });
});
