/**
 * 资料分区「文风与基调」测试（app 端缺口，用户反馈 2026-11-26：文风/情绪没地方选、预设也不能选）。
 * 验证：未绑定主预设时的引导与绑定入口 / 绑定后出现预设选项面板 / 保存文风与基调时保留 settings 其余字段。
 * api 模块级 mock；PresetGroupPicker 替身（真组件会发预设请求与 AI 预选）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultNovelSettings, type Work } from '@shared/work';

import { apiFetch } from '../../../../../api/client';
import { getPreset, listPresets } from '../../../../../api/library';
import { updateWork } from '../../../../../api/works';
import StylePane from '../StylePane';

vi.mock('../../../../../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../../../api/library', () => ({ getPreset: vi.fn(), listPresets: vi.fn() }));
vi.mock('../../../../../api/works', () => ({ updateWork: vi.fn() }));
vi.mock('../../../../workbench/preset/PresetGroupPicker', () => ({
  default: () => <div data-testid="mock-preset-group-picker" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

function workFixture(overrides: Partial<Work> = {}): Work {
  return {
    id: 'w1',
    revision: 7,
    title: '测试书',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings, presetPromptOverrides: { 'entry-a': false } },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function mount(work: Work, onSaved: (w: Work) => void = vi.fn()): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<StylePane work={work} onSaved={onSaved} />);
  });
  return container;
}

async function click(el: Element | null, what: string): Promise<void> {
  if (!el) throw new Error(`missing ${what}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 受控 select：原生 value setter 绕过 tracker 后派发 change */
async function selectOption(container: HTMLElement, testid: string, value: string): Promise<void> {
  const select = container.querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`);
  if (!select) throw new Error(`missing select ${testid}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(updateWork).mockReset();
  vi.mocked(getPreset).mockReset();
  vi.mocked(listPresets).mockReset();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
});

describe('StylePane 文风与基调', () => {
  it('未绑定主预设：给出引导、不渲染预设选项面板；选一个预设 → PATCH presetId 并回调最新作品', async () => {
    const work = workFixture();
    const onSaved = vi.fn();
    vi.mocked(listPresets).mockResolvedValue([{ id: 'p1', name: 'Sudachi' }]);
    vi.mocked(apiFetch).mockResolvedValue(work);
    vi.mocked(updateWork).mockResolvedValue({ ...work, revision: 8, presetId: 'p1' });
    const c = await mount(work, onSaved);
    expect(c.querySelector('[data-testid="style-preset-hint"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="mock-preset-group-picker"]')).toBeNull();
    await click(c.querySelector('[data-testid="style-preset-change"]'), '选择主预设');
    await act(async () => {
      await Promise.resolve();
    });
    await click(c.querySelector('[data-testid="preset-option-p1"]'), '预设 p1');
    expect(vi.mocked(updateWork).mock.calls[0]![1]).toEqual({ revision: 7, presetId: 'p1' });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 8, presetId: 'p1' }));
  });

  it('已绑定主预设：显示预设名并渲染预设选项面板（预设文风/情感基调/附加选项）', async () => {
    vi.mocked(getPreset).mockResolvedValue({ id: 'p1', name: 'Sudachi' } as never);
    const c = await mount(workFixture({ presetId: 'p1' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(c.querySelector('[data-testid="mock-preset-group-picker"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="style-preset-hint"]')).toBeNull();
    expect(c.querySelector('[data-testid="style-pane"]')!.textContent).toContain('Sudachi');
  });

  it('改写作风格与故事基调后保存：以最新 revision PATCH 完整 settings，其余字段保留', async () => {
    const work = workFixture();
    const onSaved = vi.fn();
    vi.mocked(apiFetch).mockResolvedValue(work);
    vi.mocked(updateWork).mockResolvedValue({ ...work, revision: 8 });
    const c = await mount(work, onSaved);
    const save = c.querySelector<HTMLButtonElement>('[data-testid="style-save"]')!;
    expect(save.disabled).toBe(true); // 没改动时不可保存
    await selectOption(c, 'style-writing', 'fanqie');
    await click(c.querySelector('[data-testid="style-tone-温情治愈"]'), '基调 chip');
    await click(c.querySelector('[data-testid="style-save"]'), '保存');
    const body = vi.mocked(updateWork).mock.calls[0]![1];
    expect(body.revision).toBe(7);
    expect(body.settings?.writingStyle).toBe('fanqie');
    expect(body.settings?.storyTones).toEqual(['热血爽文', '温情治愈']);
    expect(body.settings?.presetPromptOverrides).toEqual({ 'entry-a': false }); // 同层字段不丢
    expect(body.settings?.desiredChapterCount).toBe(defaultNovelSettings.desiredChapterCount);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
