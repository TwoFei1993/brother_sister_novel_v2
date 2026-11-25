/**
 * 手机端新建作品弹窗测试（用户反馈 2026-11-24：手机端新建小说看不到「写作风格 / 内容形态」下拉——
 * 此前只加在桌面端 NewWorkDialog）。验证两个下拉已渲染、选择结果随 settings 下发。
 * api/works 模块级 mock（listWorks / createWork），MemoryRouter 包裹。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listPresets } from '../../../api/library';
import { createWork, listWorks } from '../../../api/works';

import MobileBookshelf from '../create/MobileBookshelf';

vi.mock('../../../api/library', () => ({ listPresets: vi.fn() }));
vi.mock('../../../api/works', () => ({
  createWork: vi.fn(),
  deleteWork: vi.fn(),
  getWork: vi.fn(),
  listWorks: vi.fn(),
  updateWork: vi.fn(),
}));

const createWorkMock = vi.mocked(createWork);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

async function mountShelf(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <MobileBookshelf />
      </MemoryRouter>,
    );
  });
  return container;
}

async function click(el: Element | null, what = 'element'): Promise<void> {
  if (!el) throw new Error(`missing ${what}`);
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 受控 select：原生 value setter 绕过 tracker 后派发 change（React onChange） */
async function selectOption(container: HTMLElement, testid: string, value: string): Promise<void> {
  const select = container.querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`);
  if (!select) throw new Error(`missing select ${testid}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function fillTitle(container: HTMLElement, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('[data-testid="new-work-title"]');
  if (!input) throw new Error('missing title input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function openNovelDialog(): Promise<HTMLElement> {
  const container = await mountShelf();
  await click(container.querySelector('[data-testid="new-work-btn"]'), '新建入口');
  return container;
}

async function submit(container: HTMLElement): Promise<void> {
  await click(container.querySelector('[data-testid="new-work-submit"]'), '提交按钮');
}

beforeEach(() => {
  vi.mocked(listWorks).mockReset().mockResolvedValue([]);
  vi.mocked(listPresets).mockReset().mockResolvedValue([]);
  createWorkMock.mockReset().mockResolvedValue({ id: 'new-work-1' } as never);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
});

describe('手机端新建作品：写作风格与内容形态', () => {
  it('小说模式弹窗渲染「写作风格」「内容形态」两个下拉，选项与共享枚举一致', async () => {
    const container = await openNovelDialog();
    const style = container.querySelector<HTMLSelectElement>('[data-testid="new-work-style"]');
    const format = container.querySelector<HTMLSelectElement>('[data-testid="new-work-format"]');
    expect(style).not.toBeNull();
    expect(format).not.toBeNull();
    expect([...style!.options].map((o) => o.value)).toEqual(['default', 'qidian', 'jjwxc', 'fanqie', 'custom']);
    expect([...format!.options].map((o) => o.value)).toContain('script_hongguo');
    expect([...format!.options].map((o) => o.textContent)).toContain('红果短剧剧本');
  });

  it('选风格与形态后提交 → 随 settings 下发，题材与顶层一致', async () => {
    const container = await openNovelDialog();
    await selectOption(container, 'new-work-style', 'fanqie'); // 番茄·快节奏
    await selectOption(container, 'new-work-format', 'script_hongguo');
    await fillTitle(container, '手机端测试书');
    await submit(container);
    expect(createWorkMock).toHaveBeenCalledTimes(1);
    const input = createWorkMock.mock.calls[0]![0];
    expect(input.settings?.writingStyle).toBe('fanqie');
    expect(input.settings?.format).toBe('script_hongguo');
    expect(input.settings?.genre).toBe(input.genre); // 此前手机端不传 settings，题材恒为默认「穿越」
    expect(input.mode).toBe('novel');
  });

  it('不改默认值直接提交 → 经典网文 + 默认网文长篇', async () => {
    const container = await openNovelDialog();
    await fillTitle(container, '默认值测试书');
    await submit(container);
    const input = createWorkMock.mock.calls[0]![0];
    expect(input.settings?.writingStyle).toBe('default');
    expect(input.settings?.format).toBe('default');
  });

  it('选「红果短剧剧本」后显示体量提示', async () => {
    const container = await openNovelDialog();
    await selectOption(container, 'new-work-format', 'script_hongguo');
    const hint = container.querySelector('[data-testid="new-work-format-hint"]');
    expect(hint?.textContent).toContain('每章约 500 字');
    expect(hint?.textContent).toContain('80');
  });

  it('短剧模式不显示这两个下拉（短剧走独立流程）', async () => {
    const container = await openNovelDialog();
    await click(container.querySelector('[data-testid="new-work-mode-duanju"]'), '短剧模式');
    expect(container.querySelector('[data-testid="new-work-style"]')).toBeNull();
    expect(container.querySelector('[data-testid="new-work-format"]')).toBeNull();
  });

  it('主预设下拉（2026-11-26：手机端建书此前不带主预设）：默认不绑定，选了随 createWork 下发', async () => {
    vi.mocked(listPresets).mockResolvedValue([{ id: 'p1', name: 'Sudachi' }]);
    const container = await openNovelDialog();
    await act(async () => {
      await Promise.resolve(); // 等预设列表加载
    });
    const preset = container.querySelector<HTMLSelectElement>('[data-testid="new-work-preset"]');
    expect(preset).not.toBeNull();
    expect([...preset!.options].map((o) => o.textContent)).toEqual(['不绑定', 'Sudachi']);
    await fillTitle(container, '不绑定的书');
    await submit(container);
    expect(createWorkMock.mock.calls[0]![0].presetId).toBe('');
    await click(container.querySelector('[data-testid="new-work-btn"]'), '新建入口');
    await selectOption(container, 'new-work-preset', 'p1');
    await fillTitle(container, '绑定预设的书');
    await submit(container);
    expect(createWorkMock.mock.calls[1]![0].presetId).toBe('p1');
  });
});
