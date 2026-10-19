/**
 * 资产库页面与提示词管理器渲染测试（jsdom + createRoot，无 testing-library 依赖）
 * 覆盖：Tab 切换 + URL query 同步 / PromptManager 排序渲染 + 启停回调 /
 * 上下移动重排 / token 预览数字出现。API 层模块级 mock，不触网。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresetAsset } from '@shared/preset';

import { getPreset, importAsset, listAssets, updatePresetRaw } from '../../../api/library';
import LibraryPage from '../../../pages/LibraryPage';
import PromptManager from '../prompts/PromptManager';

vi.mock('../../../api/library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/library')>();
  return {
    ...actual,
    listAssets: vi.fn(async () => []),
    getAsset: vi.fn(async () => {
      throw new Error('详情加载失败（测试 mock）');
    }),
    importAsset: vi.fn(async (file: File) => ({ id: 'io-new', name: String(file.name) })),
    deleteAsset: vi.fn(async () => undefined),
    exportAsset: vi.fn(async () => undefined),
    getPreset: vi.fn(),
    updatePresetRaw: vi.fn(async () => undefined),
  };
});

const listAssetsMock = vi.mocked(listAssets);
const getPresetMock = vi.mocked(getPreset);
const updatePresetRawMock = vi.mocked(updatePresetRaw);
const importAssetMock = vi.mocked(importAsset);

// React 19 act 环境声明（与 Bookshelf.test 同款就地声明）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 预设夹具：2 marker（main/chatHistory）+ 1 自定义（style-a，默认停用） */
function presetFixture(): PresetAsset {
  return {
    id: 'p1',
    name: 'Default',
    raw: {
      prompts: [
        { identifier: 'main', name: '主提示词', role: 'system', content: '你是小说家', system_prompt: true },
        { identifier: 'chatHistory', name: 'Chat History', marker: true },
        { identifier: 'style-a', name: '风格加成', role: 'system', content: '文风要求：细腻。' },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: 'main', enabled: true },
            { identifier: 'chatHistory', enabled: true },
            { identifier: 'style-a', enabled: false },
          ],
        },
      ],
    },
  };
}

// ---------- 渲染工具 ----------

const roots: Root[] = [];

async function mount(ui: React.ReactElement, initial = '/library'): Promise<{ container: HTMLElement; search: () => string }> {
  let latestSearch = '';
  function LocationProbe() {
    const { search } = useLocation();
    latestSearch = search;
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[initial]}>
        <LocationProbe />
        {ui}
      </MemoryRouter>,
    );
  });
  return { container, search: () => latestSearch };
}

async function mountPlain(ui: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(ui);
  });
  return container;
}

beforeEach(() => {
  listAssetsMock.mockReset();
  getPresetMock.mockReset();
  updatePresetRawMock.mockClear();
  importAssetMock.mockClear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
});

// ---------- 用例 ----------

describe('LibraryPage', () => {
  it('Tab 切换并同步 URL query（深链 ?tab=worldbooks 可达）', async () => {
    listAssetsMock.mockResolvedValue([]);
    const { container, search } = await mount(<LibraryPage />);

    // 默认 Tab = 角色卡；无 query
    expect(search()).toBe('');
    expect(container.querySelector('[aria-label="角色卡资产面板"]')).not.toBeNull();

    // 点击「世界书」→ URL 同步 + 面板切换
    const wbTab = container.querySelector<HTMLButtonElement>('button[data-tab="worldbooks"]');
    expect(wbTab).not.toBeNull();
    await act(async () => {
      wbTab!.click();
    });
    expect(search()).toBe('?tab=worldbooks');
    expect(container.querySelector('[aria-label="世界书资产面板"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="角色卡资产面板"]')).toBeNull();
  });

  it('深链 ?tab=presets 直接打开预设面板', async () => {
    listAssetsMock.mockResolvedValue([]);
    const { container } = await mount(<LibraryPage />, '/library?tab=presets');
    expect(container.querySelector('[aria-label="预设资产面板"]')).not.toBeNull();
    expect(container.querySelector('button[data-tab="presets"]')?.getAttribute('aria-current')).toBe('true');
  });

  it('粘贴导入成功后刷新资产列表并选中新预设', async () => {
    listAssetsMock
      .mockResolvedValueOnce([{ id: 'p1', name: 'Default' }])
      .mockResolvedValue([{ id: 'p1', name: 'Default' }, { id: 'p2', name: '新导入预设' }]);
    getPresetMock.mockResolvedValue(presetFixture());
    importAssetMock.mockResolvedValue({ id: 'p2', name: '新导入预设' });

    const { container } = await mount(<LibraryPage />, '/library?tab=presets');

    // 选中 Default 打开提示词管理器
    const editBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === '编辑')!;
    await act(async () => {
      editBtn.click();
    });
    expect(container.querySelector('[aria-label="提示词管理器"]')).not.toBeNull();

    // 展开粘贴表单并填入最小预设 JSON
    const pasteBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('从 JSON 粘贴导入'),
    )!;
    await act(async () => {
      pasteBtn.click();
    });
    const ta = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="粘贴预设 JSON"]')!;
    expect(ta).not.toBeNull();
    const minimal = JSON.stringify({
      prompts: [{ identifier: 'main', name: 'M', content: 'x' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
    });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, minimal);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const importBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === '导入为新预设')!;
    await act(async () => {
      importBtn.click();
    });
    await act(async () => {});

    // 列表被重新拉取并出现新资产；管理器切换为选中新预设
    expect(importAssetMock).toHaveBeenCalledTimes(1);
    expect(listAssetsMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('新导入预设');
  });
});

describe('PromptManager', () => {
  async function mountManager(): Promise<HTMLElement> {
    getPresetMock.mockResolvedValue(presetFixture());
    return mountPlain(<PromptManager presetId="p1" notify={() => undefined} onImportedNew={() => undefined} />);
  }

  it('按 prompt_order 顺序渲染行：marker 标「系统位」，停用行置灰', async () => {
    const container = await mountManager();
    const rows = [...container.querySelectorAll('[data-prompt-row]')];
    expect(rows.map((r) => r.getAttribute('data-prompt-row'))).toEqual(['main', 'chatHistory', 'style-a']);

    const text = container.textContent ?? '';
    // chatHistory 是 marker → 系统位徽标；自定义项不标
    const chatRow = rows[1];
    expect(chatRow.textContent).toContain('系统位');
    expect(rows[2].textContent).not.toContain('系统位');
    // style-a 停用行有「未保存」无关；仅校验停用样式类（dashed border）
    expect(rows[2].className).toContain('border-dashed');
    expect(text).toContain('风格加成');
  });

  it('启停回调：点击停用行的 checkbox 翻转启用态并标记未保存（不自动发 PATCH）', async () => {
    const container = await mountManager();
    const styleRow = container.querySelector('[data-prompt-row="style-a"]')!;
    const checkbox = styleRow.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(false);

    await act(async () => {
      checkbox.click();
    });

    const after = container.querySelector('[data-prompt-row="style-a"]')!;
    expect(after.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(container.textContent).toContain('未保存');
    expect(updatePresetRawMock).not.toHaveBeenCalled();
  });

  it('上移重排：style-a 上移一行后顺序变为 main → style-a → chatHistory', async () => {
    const container = await mountManager();
    const upBtn = container.querySelector<HTMLButtonElement>(
      '[data-prompt-row="style-a"] button[aria-label="上移 风格加成"]',
    )!;
    await act(async () => {
      upBtn.click();
    });
    const rows = [...container.querySelectorAll('[data-prompt-row]')];
    expect(rows.map((r) => r.getAttribute('data-prompt-row'))).toEqual(['main', 'style-a', 'chatHistory']);
    expect(updatePresetRawMock).not.toHaveBeenCalled();
  });

  it('token 预览：头部总 token 与行级 ~N 数字出现', async () => {
    const container = await mountManager();
    const text = container.textContent ?? '';
    // 头部干跑总 token（内容非空 → 必为正数）
    expect(text).toMatch(/预估总 token：~[1-9]\d*/);
    // 行级：main「你是小说家」≈ 5 汉字 × 1.5 = 8（近似计数引擎锚点值）
    const mainRow = container.querySelector('[data-prompt-row="main"]')!;
    expect(mainRow.textContent).toContain('~8');
    // 行级至少两条 ~N（marker chatHistory 无内容显示 —）
    expect((text.match(/~\d+/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
