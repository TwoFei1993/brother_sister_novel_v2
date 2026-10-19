/**
 * StyleClonePanel 测试（api 层模块级 mock，模式同 WorkSettingsSheet.test）
 *
 * 覆盖（深度测试报告低危缺陷修复回归）：
 * - 保存超 STYLE_GUIDE_MAX_CHARS：截断保存并显示提示（style-notice）
 * - work.revision 变化：本地编辑态与服务端对齐（外部保存不丢同步）
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { updateWork } from '../../../api/works';
import { STYLE_GUIDE_MAX_CHARS } from '../../../engine/prompt/novel/settings-block';
import type { Work } from '@shared/work';
import { defaultNovelSettings } from '@shared/work';

import StyleClonePanel from '../dialog/StyleClonePanel';

vi.mock('../../../api/works', () => ({
  updateWork: vi.fn(),
}));

const updateWorkMock = vi.mocked(updateWork);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

function workFixture(styleGuide: string | undefined, revision = 1): Work {
  return {
    id: 'w1',
    revision,
    title: '测试作品',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings, ...(styleGuide !== undefined ? { styleGuide } : {}) },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

interface Harness {
  container: HTMLElement;
  rerender: (work: Work) => Promise<void>;
}

async function mountPanel(work: Work): Promise<Harness> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (w: Work): void =>
    root.render(<StyleClonePanel work={w} onSaved={() => undefined} />);
  await act(async () => {
    render(work);
  });
  return {
    container,
    rerender: async (w: Work) => {
      await act(async () => {
        render(w);
      });
    },
  };
}

async function typeGuide(h: Harness, text: string): Promise<void> {
  const textarea = h.container.querySelector<HTMLTextAreaElement>('[data-testid="style-guide"]');
  if (!textarea) throw new Error('missing style-guide textarea');
  // React 受控组件：原生 setter 绕过 value tracker 后派发 input 事件（change 不触发 React onChange）
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function clickSave(h: Harness): Promise<void> {
  const btn = h.container.querySelector<HTMLButtonElement>('[data-testid="style-save-guide"]');
  if (!btn) throw new Error('missing save button');
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('StyleClonePanel', () => {
  beforeEach(() => {
    updateWorkMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots) root.unmount();
    });
    roots.length = 0;
    document.body.innerHTML = '';
  });

  it('保存超上限：截断到 STYLE_GUIDE_MAX_CHARS 写入并显示截断提示', async () => {
    updateWorkMock.mockResolvedValue(workFixture('长'.repeat(STYLE_GUIDE_MAX_CHARS), 2));
    const h = await mountPanel(workFixture(undefined));
    const long = '长'.repeat(STYLE_GUIDE_MAX_CHARS + 100);
    await typeGuide(h, long);
    await clickSave(h);
    expect(updateWorkMock).toHaveBeenCalledTimes(1);
    const saved = updateWorkMock.mock.calls[0]![1] as { settings: { styleGuide: string } };
    expect(saved.settings.styleGuide).toHaveLength(STYLE_GUIDE_MAX_CHARS); // 截断写入
    const notice = h.container.querySelector('[data-testid="style-notice"]');
    expect(notice?.textContent).toContain('截断');
  });

  it('work.revision 变化：本地编辑态与服务端 styleGuide 重新对齐（不再滞留旧草稿）', async () => {
    const h = await mountPanel(workFixture('服务端画像', 1));
    const before = h.container.querySelector<HTMLTextAreaElement>('[data-testid="style-guide"]');
    expect(before?.value).toBe('服务端画像');
    await typeGuide(h, '本地未保存的草稿');
    // 外部保存（或切换作品）→ revision 变化 → 本地态对齐服务端
    await h.rerender(workFixture('外部更新后的画像', 2));
    const after = h.container.querySelector<HTMLTextAreaElement>('[data-testid="style-guide"]');
    expect(after?.value).toBe('外部更新后的画像');
  });
});
