/**
 * 手机端新建作品弹窗测试（用户反馈 2026-11-24：手机端新建小说看不到「写作风格 / 内容形态」下拉——
 * 此前只加在桌面端 NewWorkDialog）。验证两个下拉已渲染、选择结果随 settings 下发。
 * api/works 模块级 mock（listWorks / createWork），MemoryRouter 包裹。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../../../api/client';
import { listPresets } from '../../../api/library';
import { createWork, listWorks, presetPickPreview } from '../../../api/works';

import MobileBookshelf from '../create/MobileBookshelf';

vi.mock('../../../api/library', () => ({ listPresets: vi.fn() }));
vi.mock('../../../api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../api/works', () => ({
  createWork: vi.fn(),
  deleteWork: vi.fn(),
  getWork: vi.fn(),
  listWorks: vi.fn(),
  updateWork: vi.fn(),
  presetPickPreview: vi.fn(),
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
  vi.mocked(apiFetch).mockReset().mockRejectedValue(new Error('测试里没有这个请求'));
  vi.mocked(presetPickPreview).mockReset().mockRejectedValue(new Error('测试里没有这个请求'));
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

describe('手机端新建作品：故事基调与预设条目（2026-11-26 用户反馈：创建时就要能选，且真实挂预设）', () => {
  /** 点一枚基调芯片（关闭时点上 / 开着时点关） */
  async function toggleTone(container: HTMLElement, tone: string): Promise<void> {
    await click(container.querySelector(`[data-testid="new-work-tone-${tone}"]`), `基调芯片 ${tone}`);
  }

  it('基调芯片：默认含「热血爽文」；关掉它、点上「温情治愈」、填自定义 → 随 settings 下发', async () => {
    const container = await openNovelDialog();
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
    await fillTitle(container, '基调测试书');
    await submit(container);
    const settings = createWorkMock.mock.calls[0]![0].settings!;
    expect(settings.storyTones).toEqual(['温情治愈']);
    expect(settings.customStoryTone).toBe('轻松欢快');
  });

  it('绑定主预设：预设的文风 / 情感基调条目出现，勾选随 settings.presetPromptOverrides 下发', async () => {
    vi.mocked(listPresets).mockResolvedValue([{ id: 'p1', name: 'Sudachi' }]);
    vi.mocked(apiFetch).mockResolvedValue({
      id: 'p1',
      name: 'Sudachi',
      raw: {
        prompts: [
          { identifier: 'g-style', name: '—\\文风设定', content: '' },
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
              { identifier: 'style-a', enabled: true },
              { identifier: 'style-b', enabled: false },
              { identifier: 'g-tone', enabled: true },
              { identifier: 'tone-happy', enabled: false },
              { identifier: 'tone-gloomy', enabled: false },
            ],
          },
        ],
      },
    } as never);
    const container = await openNovelDialog();
    await act(async () => {
      await Promise.resolve();
    });
    await selectOption(container, 'new-work-preset', 'p1');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="new-work-preset-groups"]')).not.toBeNull();
    // 预设默认：文风 A 开、B 关；基调全关。点开基调「欢快开心」，文风换成「厚重史诗」（单选：B 开则 A 关）
    expect(container.querySelector('[data-testid="new-work-preset-style-style-a"]')?.getAttribute('aria-pressed')).toBe('true');
    await click(container.querySelector('[data-testid="new-work-preset-tone-tone-happy"]'), '基调条目');
    await click(container.querySelector('[data-testid="new-work-preset-style-style-b"]'), '文风条目');
    await fillTitle(container, '预设条目测试书');
    await submit(container);
    const input = createWorkMock.mock.calls[0]![0];
    expect(input.presetId).toBe('p1');
    expect(input.settings!.presetPromptOverrides).toEqual({ 'tone-happy': true, 'style-b': true, 'style-a': false });
  });

  it('短剧模式目标集数默认 1（用户反馈：默认出 1 集就行）', async () => {
    const container = await openNovelDialog();
    await click(container.querySelector('[data-testid="new-work-mode-duanju"]'), '短剧模式');
    const episodes = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(episodes!.value).toBe('1');
    await fillTitle(container, '短剧默认集数');
    await submit(container);
    expect(createWorkMock.mock.calls[0]![0].duanju!.targetEpisodes).toBe(1);
  });
});
