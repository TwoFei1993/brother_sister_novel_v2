/**
 * VoiceMapEditor 渲染与保存测试（api 层模块级 mock，不触网）
 * 覆盖：绑定角色行渲染（含 voiceMap 初值）/ 保存 PATCH voiceMap（含旁白声约定键）/ onSaved 上抛
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listCharacters, type LibraryAssetRef } from '../../../api/library';
import { updateWork } from '../../../api/works';
import type { Work } from '@shared/work';
import { defaultNovelSettings } from '@shared/work';

import VoiceMapEditor from '../VoiceMapEditor';

vi.mock('../../../api/library', () => ({
  listCharacters: vi.fn(),
}));

vi.mock('../../../api/works', () => ({
  updateWork: vi.fn(),
}));

const listCharactersMock = vi.mocked(listCharacters);
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

function workFixture(voiceMap: Record<string, string> = {}): Work {
  return {
    id: 'w1',
    revision: 3,
    title: '测试作品',
    mode: 'novel',
    genre: 'chuanyue',
    characterIds: ['c1', 'c2'],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: defaultNovelSettings,
    voiceMap,
    createdAt: 1,
    updatedAt: 1,
  };
}

const characters: LibraryAssetRef[] = [
  { id: 'c1', name: '哥哥' },
  { id: 'c2', name: '妹妹' },
  { id: 'c3', name: '未绑定者' },
];

async function mountEditor(work: Work, onSaved?: (w: Work) => void): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<VoiceMapEditor work={work} onSaved={onSaved} />);
  });
  await act(async () => {}); // 放掉 listCharacters 微任务
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

beforeEach(() => {
  listCharactersMock.mockResolvedValue(characters);
  updateWorkMock.mockImplementation(async (_id, input) => ({
    ...workFixture(input.voiceMap ?? {}),
    revision: input.revision + 1,
  }));
});

describe('VoiceMapEditor', () => {
  it('渲染绑定角色行并回显 voiceMap 初值；未绑定角色不出现', async () => {
    const c = await mountEditor(workFixture({ 妹妹: 'xiaobei' }));
    expect(q(c, 'voice-row-哥哥')).not.toBeNull();
    expect(q(c, 'voice-row-妹妹')).not.toBeNull();
    expect(c.textContent).not.toContain('未绑定者');
    expect((q(c, 'voice-select-妹妹') as HTMLSelectElement).value).toBe('xiaobei');
    expect((q(c, 'voice-select-哥哥') as HTMLSelectElement).value).toBe('');
  });

  it('修改声音后保存：PATCH voiceMap（revision 乐观锁）并上抛 onSaved', async () => {
    const onSaved = vi.fn();
    const work = workFixture({ 妹妹: 'xiaobei' });
    const c = await mountEditor(work, onSaved);

    await setSelect(q(c, 'voice-select-哥哥') as HTMLSelectElement, 'yunxi');
    await setSelect(q(c, 'narrator-voice') as HTMLSelectElement, 'yunyang');
    await act(async () => {
      q(c, 'voice-map-save').click();
    });
    await act(async () => {}); // 放掉保存微任务

    expect(updateWorkMock).toHaveBeenCalledWith('w1', {
      revision: 3,
      voiceMap: { 妹妹: 'xiaobei', 哥哥: 'yunxi', narrator: 'yunyang' },
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1', revision: 4 }));
    expect(c.querySelector('[role="status"]')?.textContent).toBe('已保存');
  });
});
