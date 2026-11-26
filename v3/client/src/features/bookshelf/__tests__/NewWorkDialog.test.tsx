/**
 * NewWorkDialog 测试（模式同 Bookshelf.test：jsdom + createRoot + act + 原生事件，无 testing-library）
 *
 * mock：api/works.createWork / api/library 三列表（空数组）/ misc/wizard/importAll.attributeAssets
 *
 * 覆盖（M1 Task 4 五用例）：
 * ① 默认风格随 settings 下发（writingStyle='default'，settings.genre 与顶层 genre 一致）
 * ② 风格下拉选择生效（'番茄·快节奏' → fanqie）
 * ③ chat 模式同样携带 settings.writingStyle
 * ④ duanju 模式无风格项且不走 settings、跳过资产归属补写（短剧分支）
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

describe('NewWorkDialog 同人信息（用户需求 2026-11-22：软件理解「同人」）', () => {
  it('⑥ 题材选同人衍生：显示原著字段，提交携带 settings.fandom 三字段', async () => {
    const container = await renderDialog();
    await selectOption(container, 'new-work-genre', 'fanfic');
    expect(container.querySelector('[data-testid="new-work-fanfic"]')).not.toBeNull();
    // 原著名称（原生 setter + input）
    const source = container.querySelector<HTMLInputElement>('[data-testid="new-work-fandom-source"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(source!, '某武侠原著');
      source!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // 衍生类型（select）
    await selectOption(container, 'new-work-fandom-type', 'continue');
    // 要点（textarea）
    const notes = container.querySelector<HTMLTextAreaElement>('[data-testid="new-work-fandom-notes"]');
    const tsetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      tsetter.call(notes!, '承接原作大结局');
      notes!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await submitForm(container);
    const input = firstCreateInput();
    expect(input.settings!.fandomSource).toBe('某武侠原著');
    expect(input.settings!.fandomType).toBe('continue');
    expect(input.settings!.fandomNotes).toBe('承接原作大结局');
  });

  it('⑦ 非 fanfic 题材：无同人区块，settings 不带 fandom 字段', async () => {
    const container = await renderDialog();
    expect(container.querySelector('[data-testid="new-work-fanfic"]')).toBeNull();
    await submitForm(container);
    const input = firstCreateInput();
    expect(input.settings!.fandomSource).toBeUndefined();
    expect('fandomType' in input.settings!).toBe(false);
  });
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
    expect(attributeAssetsMock).not.toHaveBeenCalled(); // 短剧不消费绑定，跳过资产归属补写
  });

  it('⑤ attributeAssets 只调用一次（重复块已删）', async () => {
    const container = await renderDialog();
    await submitForm(container); // novel 模式、空绑定
    expect(attributeAssetsMock).toHaveBeenCalledTimes(1);
    expect(attributeAssetsMock).toHaveBeenCalledWith('w1', { characterIds: [], worldbookIds: [] });
  });
});

describe('NewWorkDialog 故事基调与短剧默认集数（2026-11-26 用户反馈）', () => {
  /** 点一枚基调芯片（原生 click 不经过 React 合成——直接派发冒泡 click） */
  async function toggleTone(container: HTMLElement, tone: string): Promise<void> {
    const chip = container.querySelector(`[data-testid="new-work-tone-${tone}"]`);
    if (!chip) throw new Error(`missing tone chip ${tone}`);
    await act(async () => {
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('⑧ 基调芯片：默认「热血爽文」；改选并填自定义 → 随 settings 下发', async () => {
    const container = await renderDialog();
    expect(container.querySelector('[data-testid="new-work-tones"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="new-work-tone-热血爽文"]')?.getAttribute('aria-pressed')).toBe('true');
    await toggleTone(container, '热血爽文');
    await toggleTone(container, '温情治愈');
    const custom = container.querySelector<HTMLInputElement>('[data-testid="new-work-custom-tone"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(custom!, '轻松欢快');
      custom!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await submitForm(container);
    const input = firstCreateInput();
    expect(input.settings!.storyTones).toEqual(['温情治愈']);
    expect(input.settings!.customStoryTone).toBe('轻松欢快');
  });

  it('⑨ 短剧目标集数默认 1（默认只出 1 集的剧本与分镜）', async () => {
    const container = await renderDialog();
    await clickRadio(container, 2); // 短剧
    const episodes = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(episodes!.value).toBe('1');
    await submitForm(container);
    expect(firstCreateInput().duanju!.targetEpisodes).toBe(1);
  });
});
