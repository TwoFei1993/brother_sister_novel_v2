/**
 * NewWorkPresetGroups 组件测试（建书时的预设文风/基调选择，用户反馈 2026-11-26）：
 * 按预设默认显示勾选态；文风单选（选 B 关 A）；基调多选可开可关；加载失败可重试；无分组不渲染。
 * api/client 模块级 mock（返回假预设资产）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../../../api/client';
import NewWorkPresetGroups from '../NewWorkPresetGroups';

vi.mock('../../../../api/client', () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** 假预设资产：文风组（新文子分区，默认开 A 关 B）+ 基调组（默认全关） */
const fakeAsset = {
  id: 'p1',
  name: 'Sudachi',
  raw: {
    prompts: [
      { identifier: 'g-style', name: '—\\文风设定', content: '' },
      { identifier: 'sec', name: '===新文===', content: '' },
      { identifier: 'style-a', name: '轻盈日常', content: 'a' },
      { identifier: 'style-b', name: '厚重史诗', content: 'b' },
      { identifier: 'g-tone', name: '—\\情感基调', content: '' },
      { identifier: 'tone-happy', name: '欢快开心', content: '' },
      { identifier: 'tone-gloomy', name: '压抑', content: '' },
    ],
    prompt_order: [
      {
        order: [
          { identifier: 'g-style', enabled: true },
          { identifier: 'sec', enabled: true },
          { identifier: 'style-a', enabled: true },
          { identifier: 'style-b', enabled: false },
          { identifier: 'g-tone', enabled: true },
          { identifier: 'tone-happy', enabled: false },
          { identifier: 'tone-gloomy', enabled: false },
        ],
      },
    ],
  },
};

async function mount(presetId = 'p1', overrides: Record<string, boolean> = {}): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<NewWorkPresetGroups presetId={presetId} overrides={overrides} onChange={() => undefined} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

async function click(c: HTMLElement, testid: string): Promise<void> {
  const el = c.querySelector(`[data-testid="${testid}"]`);
  if (!el) throw new Error(`missing ${testid}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  apiFetchMock.mockReset().mockResolvedValue(fakeAsset as never);
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
});

describe('NewWorkPresetGroups 建书时的预设选项', () => {
  it('渲染文风与基调两组芯片，勾选态按预设默认（A 开、B 与基调关）', async () => {
    const c = await mount();
    expect(c.querySelector('[data-testid="new-work-preset-groups"]')?.textContent).toContain('Sudachi');
    const pressed = (testid: string): string | null =>
      c.querySelector(`[data-testid="${testid}"]`)?.getAttribute('aria-pressed') ?? null;
    expect(pressed('new-work-preset-style-style-a')).toBe('true');
    expect(pressed('new-work-preset-style-style-b')).toBe('false');
    expect(pressed('new-work-preset-tone-tone-happy')).toBe('false');
    expect(c.querySelector('[data-testid="new-work-preset-style-group"]')?.textContent).toContain('单选');
    expect(c.querySelector('[data-testid="new-work-preset-tone-group"]')?.textContent).toContain('可多选');
  });

  it('文风单选：点 B → 回传 B 开、A 关（组内其余关闭，保证只选一个）', async () => {
    const onChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(<NewWorkPresetGroups presetId="p1" overrides={{}} onChange={onChange} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await click(container, 'new-work-preset-style-style-b');
    expect(onChange).toHaveBeenCalledWith({ 'style-b': true, 'style-a': false });
  });

  it('基调多选：点开、再点关，回传对应的覆盖值', async () => {
    const onChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(<NewWorkPresetGroups presetId="p1" overrides={{}} onChange={onChange} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await click(container, 'new-work-preset-tone-tone-happy');
    expect(onChange).toHaveBeenLastCalledWith({ 'tone-happy': true });

    // 已开的情况下再点 → 关（重挂以受控值渲染，模拟父组件回写）
    const container2 = document.createElement('div');
    document.body.appendChild(container2);
    const root2 = createRoot(container2);
    roots.push(root2);
    await act(async () => {
      root2.render(<NewWorkPresetGroups presetId="p1" overrides={{ 'tone-happy': true }} onChange={onChange} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await click(container2, 'new-work-preset-tone-tone-happy');
    expect(onChange).toHaveBeenLastCalledWith({ 'tone-happy': false });
  });

  it('加载失败：显示人话提示与重试；预设没有可按书选的分组时不渲染', async () => {
    apiFetchMock.mockRejectedValue(new Error('offline'));
    const c = await mount();
    expect(c.querySelector('[data-testid="new-work-preset-groups-error"]')?.textContent).toContain('加载失败');

    apiFetchMock.mockResolvedValue({ id: 'p2', name: 'Default', raw: { prompts: [], prompt_order: [{ order: [] }] } } as never);
    const empty = await mount('p2');
    expect(empty.querySelector('[data-testid="new-work-preset-groups"]')).toBeNull();
  });
});
