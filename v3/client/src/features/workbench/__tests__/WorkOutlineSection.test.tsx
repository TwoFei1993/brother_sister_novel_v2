/**
 * WorkOutlineSection 章节大纲完整编辑器测试（反馈⑦；api 层模块级 mock，不触网）
 * 覆盖：渲染全部章（滚动列表）/ 编辑保存回调携数据（乐观锁 revision）/ 删除章 /
 * 添加章（最大章号+1）/ 保存失败提示不回传。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { updateWork } from '../../../api/works';
import type { Work } from '@shared/work';
import { defaultNovelSettings } from '@shared/work';

import WorkOutlineSection from '../WorkOutlineSection';

vi.mock('../../../api/works', () => ({
  updateWork: vi.fn(),
}));

// DocImport（misc/wizard）为文件导入控件，编辑器测试不涉及其交互，mock 为占位
vi.mock('../../misc/wizard/DocImport', () => ({
  default: () => <button type="button" data-testid="doc-import-stub">导入文档</button>,
}));

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

function workFixture(chapterOutlines: Work['settings']['chapterOutlines']): Work {
  return {
    id: 'w1',
    revision: 3,
    title: '测试作品',
    mode: 'novel',
    genre: 'chuanyue',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings, chapterOutlines },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

const THREE = [
  { index: 1, title: '落地嫡长', plot: '胎穿嫡长女，隐藏空间。' },
  { index: 2, title: '私囤万千', plot: '幼年囤积。' },
  { index: 3, title: '幼学启蒙', plot: '起步碾压。' },
];

async function mountSection(work: Work, onSaved?: (w: Work) => void): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<WorkOutlineSection work={work} onSaved={onSaved ?? (() => undefined)} />);
  });
  return container;
}

const q = (c: HTMLElement, id: string): HTMLElement => {
  const el = c.querySelector(`[data-testid="${id}"]`);
  if (!el) throw new Error(`missing [data-testid=${id}]`);
  return el as HTMLElement;
};

const setInput = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

const setTextarea = (el: HTMLTextAreaElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

beforeEach(() => {
  updateWorkMock.mockReset();
  updateWorkMock.mockImplementation(async (_id, input) => ({
    ...workFixture(input.settings?.chapterOutlines),
    revision: input.revision + 1,
  }));
});

describe('WorkOutlineSection 章节大纲完整编辑器（反馈⑦）', () => {
  it('渲染全部章：3 章各一行（章号/标题/剧情值正确），滚动容器存在', async () => {
    const c = await mountSection(workFixture(THREE));
    expect(q(c, 'outline-list').className).toContain('overflow-y-auto');
    for (let i = 0; i < 3; i++) {
      expect((q(c, `outline-index-${i}`) as HTMLInputElement).value).toBe(String(i + 1));
      expect((q(c, `outline-title-${i}`) as HTMLInputElement).value).toBe(THREE[i]!.title);
      expect((q(c, `outline-plot-${i}`) as HTMLTextAreaElement).value).toBe(THREE[i]!.plot);
    }
  });

  it('编辑标题与剧情后保存：PATCH 携编辑后 chapterOutlines（乐观锁 revision），onSaved 同步', async () => {
    const onSaved = vi.fn();
    const c = await mountSection(workFixture(THREE), onSaved);
    await setInput(q(c, 'outline-title-1') as HTMLInputElement, '私囤万千（改）');
    await setTextarea(q(c, 'outline-plot-1') as HTMLTextAreaElement, '幼年囤积，初显手段。');
    await act(async () => {
      q(c, 'outline-save').click();
    });
    await act(async () => {}); // 放掉 PATCH 微任务

    expect(updateWorkMock).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        revision: 3,
        settings: expect.objectContaining({
          chapterOutlines: [
            { index: 1, title: '落地嫡长', plot: '胎穿嫡长女，隐藏空间。' },
            { index: 2, title: '私囤万千（改）', plot: '幼年囤积，初显手段。' },
            { index: 3, title: '幼学启蒙', plot: '起步碾压。' },
          ],
        }),
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1', revision: 4 }));
    expect(q(c, 'chapter-outline-msg').textContent).toContain('已保存 3 章大纲');
  });

  it('删除章：行移除后保存 PATCH 不含该章', async () => {
    const c = await mountSection(workFixture(THREE));
    await act(async () => {
      q(c, 'outline-remove-0').click();
    });
    expect(c.querySelector('[data-testid="outline-row-2"]')).toBeNull(); // 3 行变 2 行
    await act(async () => {
      q(c, 'outline-save').click();
    });
    await act(async () => {});

    const outlines = updateWorkMock.mock.calls[0]![1].settings?.chapterOutlines ?? [];
    expect(outlines.map((o) => o.index)).toEqual([2, 3]);
  });

  it('添加章：追加「最大章号+1」空章，保存一并入库', async () => {
    const c = await mountSection(workFixture(THREE));
    await act(async () => {
      q(c, 'outline-add').click();
    });
    const rows = c.querySelectorAll('[data-testid^="outline-row-"]').length;
    expect(rows).toBe(4);
    expect((q(c, 'outline-index-3') as HTMLInputElement).value).toBe('4');

    await setInput(q(c, 'outline-title-3') as HTMLInputElement, '崭新篇章');
    await act(async () => {
      q(c, 'outline-save').click();
    });
    await act(async () => {});

    const outlines = updateWorkMock.mock.calls[0]![1].settings?.chapterOutlines ?? [];
    expect(outlines.at(-1)).toMatchObject({ index: 4, title: '崭新篇章', plot: '' });
  });

  it('保存失败（如版本冲突）：错误提示且不调用 onSaved', async () => {
    updateWorkMock.mockRejectedValueOnce(new Error('版本冲突，请刷新'));
    const onSaved = vi.fn();
    const c = await mountSection(workFixture(THREE), onSaved);
    await act(async () => {
      q(c, 'outline-save').click();
    });
    await act(async () => {});

    expect(q(c, 'chapter-outline-msg').textContent).toContain('版本冲突');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('无大纲作品：列表不渲染（提示手动添加），添加章从 1 起', async () => {
    const c = await mountSection(workFixture(undefined));
    expect(c.querySelector('[data-testid="outline-list"]')).toBeNull();
    await act(async () => {
      q(c, 'outline-add').click();
    });
    expect((q(c, 'outline-index-0') as HTMLInputElement).value).toBe('1');
  });
});
