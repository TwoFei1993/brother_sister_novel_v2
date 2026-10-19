/**
 * WorkSettingsSheet 绑定编辑测试（api 层模块级 mock，不触网；模式同 VoiceMapEditor.test）
 * 覆盖：添加绑定回调携 id（PATCH 携完整新名单）/ 移除回调（PATCH 名单不含该 id）/ 失败回滚
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listCharacters, listPresets, listWorldbooks, type LibraryAssetRef } from '../../../api/library';
import { updateWork } from '../../../api/works';
import type { Work } from '@shared/work';
import { defaultNovelSettings } from '@shared/work';

import WorkSettingsSheet from '../WorkSettingsSheet';

vi.mock('../../../api/library', () => ({
  listCharacters: vi.fn(),
  listWorldbooks: vi.fn(),
  listPresets: vi.fn(),
}));

vi.mock('../../../api/works', () => ({
  updateWork: vi.fn(),
}));

const listCharactersMock = vi.mocked(listCharacters);
const listWorldbooksMock = vi.mocked(listWorldbooks);
const listPresetsMock = vi.mocked(listPresets);
const updateWorkMock = vi.mocked(updateWork);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
});

function workFixture(worldbookIds: string[] = ['b1']): Work {
  return {
    id: 'w1',
    revision: 3,
    title: '测试作品',
    mode: 'novel',
    genre: 'chuanyue',
    characterIds: ['c1'],
    worldbookIds,
    presetId: '',
    regexScriptIds: [],
    settings: defaultNovelSettings,
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

const assets: Record<'characters' | 'worldbooks' | 'presets', LibraryAssetRef[]> = {
  characters: [
    { id: 'c1', name: '哥哥' },
    { id: 'c3', name: '路人甲' },
  ],
  worldbooks: [
    { id: 'b1', name: '主世界书' },
    { id: 'b2', name: '地图册' },
  ],
  presets: [{ id: 'p1', name: '网文标准预设' }],
};

async function mountSheet(work: Work, onSaved?: (w: Work) => void): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<WorkSettingsSheet work={work} onClose={() => undefined} onSaved={onSaved ?? (() => undefined)} />);
  });
  await act(async () => {}); // 放掉资产列表微任务
  return container;
}

const q = (c: HTMLElement, id: string): HTMLElement => {
  const el = c.querySelector(`[data-testid="${id}"]`);
  if (!el) throw new Error(`missing [data-testid=${id}]`);
  return el as HTMLElement;
};

const setSelect = (el: HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

const setInput = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

beforeEach(() => {
  listCharactersMock.mockResolvedValue(assets.characters);
  listWorldbooksMock.mockResolvedValue(assets.worldbooks);
  listPresetsMock.mockResolvedValue(assets.presets);
  updateWorkMock.mockImplementation(async (_id, input) => ({
    ...workFixture('worldbookIds' in input && input.worldbookIds ? input.worldbookIds : ['b1']),
    ...(input.presetId !== undefined ? { presetId: input.presetId } : {}),
    revision: input.revision + 1,
  }));
});

describe('WorkSettingsSheet 绑定编辑', () => {
  it('添加世界书：PATCH 携含新 id 的完整名单，onSaved 收到绑定后的 Work', async () => {
    const onSaved = vi.fn();
    const c = await mountSheet(workFixture(['b1']), onSaved);
    expect(q(c, 'binding-chip-b1')).not.toBeNull(); // 既有绑定以 chip 展示

    await setSelect(q(c, 'binding-add-世界书') as HTMLSelectElement, 'b2');
    await act(async () => {}); // 放掉 PATCH 微任务

    expect(updateWorkMock).toHaveBeenCalledWith('w1', { revision: 3, worldbookIds: ['b1', 'b2'] });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1', worldbookIds: ['b1', 'b2'] }));
    expect(q(c, 'binding-chip-b2')).not.toBeNull();
  });

  it('移除世界书：PATCH 名单不含被移除 id', async () => {
    const onSaved = vi.fn();
    const c = await mountSheet(workFixture(['b1', 'b2']), onSaved);

    await act(async () => {
      q(c, 'binding-remove-b2').click();
    });
    await act(async () => {});

    expect(updateWorkMock).toHaveBeenCalledWith('w1', { revision: 3, worldbookIds: ['b1'] });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ worldbookIds: ['b1'] }));
  });

  it('PATCH 失败：本地回滚并提示错误（不误报成功）', async () => {
    updateWorkMock.mockRejectedValueOnce(new Error('版本冲突'));
    const onSaved = vi.fn();
    const c = await mountSheet(workFixture(['b1']), onSaved);

    await setSelect(q(c, 'binding-add-世界书') as HTMLSelectElement, 'b2');
    await act(async () => {}); // 放掉失败的 PATCH 微任务

    expect(q(c, 'binding-error').textContent).toContain('版本冲突');
    expect(c.querySelector('[data-testid="binding-chip-b2"]')).toBeNull(); // 回滚
    expect(onSaved).not.toHaveBeenCalled(); // 失败不上抛
  });
});

describe('WorkSettingsSheet 生成目标（每章字数/目标章节数）', () => {
  it('初值来自作品设置（缺省字数回退 3000），保存 PATCH 携两字段', async () => {
    const base = workFixture(['b1']);
    base.settings = { ...base.settings, targetChapterWords: 5000, desiredChapterCount: 12 };
    const c = await mountSheet(base);

    expect((q(c, 'chapter-words') as HTMLInputElement).value).toBe('5000');
    expect((q(c, 'chapter-count') as HTMLInputElement).value).toBe('12');

    await setInput(q(c, 'chapter-words') as HTMLInputElement, '2000');
    await setInput(q(c, 'chapter-count') as HTMLInputElement, '5');
    await act(async () => {
      q(c, 'settings-save').click();
    });

    expect(updateWorkMock).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        settings: expect.objectContaining({ targetChapterWords: 2000, desiredChapterCount: 5 }),
      }),
    );
  });

  it('字数输入空串/非法值保存时兜底回退默认 3000', async () => {
    const c = await mountSheet(workFixture(['b1']));
    await setInput(q(c, 'chapter-words') as HTMLInputElement, '');
    await act(async () => {
      q(c, 'settings-save').click();
    });

    expect(updateWorkMock).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        settings: expect.objectContaining({ targetChapterWords: 3000 }),
      }),
    );
  });
});
