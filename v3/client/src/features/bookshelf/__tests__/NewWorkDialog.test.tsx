/**
 * NewWorkDialog 测试（模式同 Bookshelf.test：jsdom + createRoot + act + 原生事件，无 testing-library）
 *
 * mock：api/works.createWork / api/library 三列表（空数组）/ misc/wizard/importAll.attributeAssets
 *
 * 覆盖（M1 Task 4 五用例）：
 * ① 默认风格随 settings 下发（writingStyle='default'，settings.genre 与顶层 genre 一致）
 * ② 风格下拉选择生效（'番茄·快节奏' → fanqie）
 * ③ chat 模式同样携带 settings.writingStyle
 * ④ duanju 模式无风格项且不走 settings（短剧分支）
 * ⑤ attributeAssets 只调用一次（重复调用块修复）
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { createWork, type CreateWorkInput } from '../../../api/works';
import { attributeAssets } from '../../../features/misc/wizard/importAll';
import type { Work } from '@shared/work';

import NewWorkDialog from '../NewWorkDialog';

vi.mock('../../../api/works', () => ({
  createWork: vi.fn(),
}));

vi.mock('../../../api/library', () => ({
  listCharacters: vi.fn(async () => []),
  listWorldbooks: vi.fn(async () => []),
  listPresets: vi.fn(async () => []),
}));

vi.mock('../../../features/misc/wizard/importAll', () => ({
  attributeAssets: vi.fn(),
}));

const createWorkMock = vi.mocked(createWork);
const attributeAssetsMock = vi.mocked(attributeAssets);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

const createdWork = { id: 'w1' } as unknown as Work;

async function renderDialog(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <NewWorkDialog onClose={() => undefined} />
      </MemoryRouter>,
    );
  });
  return container;
}

/** 受控 input 赋值：原生 value setter 绕过 tracker 后派发 input 事件（React onChange） */
async function fillTitle(container: HTMLElement, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[placeholder="给作品起个名字"]');
  if (!input) throw new Error('missing title input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** select 切换：原生 value setter + change 事件（React onChange） */
async function selectOption(container: HTMLElement, testid: string, value: string): Promise<void> {
  const select = container.querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`);
  if (!select) throw new Error(`missing select ${testid}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** 模式单选：MODE_CHOICES 顺序 novel=0 / chat=1 / duanju=2 */
async function clickRadio(container: HTMLElement, index: number): Promise<void> {
  const radios = container.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  const radio = radios[index];
  if (!radio) throw new Error(`missing radio ${index}`);
  await act(async () => {
    radio.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 填标题后提交表单（jsdom 直接派发 submit 事件，同 WorkbenchView.test） */
async function submitForm(container: HTMLElement): Promise<void> {
  await fillTitle(container, '测试作品');
  const form = container.querySelector<HTMLFormElement>('form[role="dialog"]');
  if (!form) throw new Error('missing dialog form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function firstCreateInput(): CreateWorkInput {
  expect(createWorkMock).toHaveBeenCalledTimes(1);
  return createWorkMock.mock.calls[0]![0];
}

beforeEach(() => {
  createWorkMock.mockReset();
  attributeAssetsMock.mockReset();
  createWorkMock.mockResolvedValue(createdWork);
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
});

describe('NewWorkDialog 写作风格（M1 Task 4）', () => {
  it('① 默认风格：settings.writingStyle=default 且 settings.genre 与顶层 genre 一致', async () => {
    const container = await renderDialog();
    await submitForm(container);
    const input = firstCreateInput();
    expect(input.settings).toBeDefined();
    expect(input.settings!.writingStyle).toBe('default');
    expect(input.settings!.genre).toBe('moshi'); // GENRE_OPTIONS[0].value 默认题材
    expect(input.genre).toBe(input.settings!.genre); // 顶层与 settings 一致
  });

  it('② 风格下拉生效：选「番茄·快节奏」→ settings.writingStyle=fanqie', async () => {
    const container = await renderDialog();
    await selectOption(container, 'new-work-style', 'fanqie');
    await submitForm(container);
    const input = firstCreateInput();
    expect(input.settings!.writingStyle).toBe('fanqie');
  });

  it('③ chat 模式同样携带 settings.writingStyle', async () => {
    const container = await renderDialog();
    await clickRadio(container, 1); // 对话写作
    await submitForm(container);
    const input = firstCreateInput();
    expect(input.mode).toBe('chat');
    expect(input.settings!.writingStyle).toBe('default');
  });

  it('④ duanju 模式：无风格下拉，createWork 不带 settings', async () => {
    const container = await renderDialog();
    expect(container.querySelector('[data-testid="new-work-style"]')).not.toBeNull();
    await clickRadio(container, 2); // 短剧
    expect(container.querySelector('[data-testid="new-work-style"]')).toBeNull();
    await submitForm(container);
    const input = firstCreateInput();
    expect(input.mode).toBe('duanju');
    expect('settings' in input).toBe(false);
    expect(input.duanju).toBeDefined();
  });

  it('⑤ attributeAssets 只调用一次（重复块已删）', async () => {
    const container = await renderDialog();
    await submitForm(container); // novel 模式、空绑定
    expect(attributeAssetsMock).toHaveBeenCalledTimes(1);
    expect(attributeAssetsMock).toHaveBeenCalledWith('w1', { characterIds: [], worldbookIds: [] });
  });
});
