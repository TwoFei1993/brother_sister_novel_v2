/**
 * ChapterOutlineImport 渲染测试（Word 导入实测反馈）：
 * - <3 章 → 不渲染；≥3 章 → 预览章数与前几章标题
 * - 展开书名输入 → 确认创建 → createWork 携带完整 settings（chapterOutlines + pastedOutline）
 * - 空书名拦截；创建失败展示错误
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { createWork } from '../../../api/works';
import ChapterOutlineImport from '../wizard/ChapterOutlineImport';

vi.mock('../../../api/works', () => ({
  createWork: vi.fn(),
}));

const createWorkMock = vi.mocked(createWork);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

async function mount(outline: string): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ChapterOutlineImport outline={outline} suggestedTitle="穿成嫡出大小姐的日常" />
      </MemoryRouter>,
    );
  });
  return container;
}

async function click(container: HTMLElement, testId: string): Promise<void> {
  const btn = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!btn) throw new Error(`missing button ${testId}`);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const THREE_CHAPTERS = ['第1章 落地嫡长', '剧情：胎穿。', '第2章 私囤', '剧情：囤积。', '第3章 启蒙', '剧情：碾压。'].join('\n');

describe('ChapterOutlineImport', () => {
  beforeEach(() => {
    createWorkMock.mockResolvedValue({
      id: 'w-new',
      revision: 0,
      title: 'x',
      mode: 'novel',
      genre: 'chuanyue',
      characterIds: [],
      worldbookIds: [],
      presetId: '',
      regexScriptIds: [],
      voiceMap: {},
      settings: {} as never,
      createdAt: 0,
      updatedAt: 0,
    });
  });

  it('不足 3 章：不渲染任何入口', async () => {
    const c = await mount('第1章 孤章\n剧情：只有一章。');
    expect(c.querySelector('[data-testid="chapter-outline-import"]')).toBeNull();
  });

  it('≥3 章：展示章数预览，展开书名输入后创建携带 chapterOutlines 与 pastedOutline', async () => {
    const c = await mount(THREE_CHAPTERS);
    const section = c.querySelector('[data-testid="chapter-outline-import"]');
    expect(section?.textContent).toContain('识别到 3 章大纲');
    expect(section?.textContent).toContain('第1章 落地嫡长');

    await click(c, 'outline-import-expand'); // 展开
    const input = c.querySelector<HTMLInputElement>('input[aria-label="书名"]');
    expect(input?.value).toBe('穿成嫡出大小姐的日常'); // 书名建议已预填

    await click(c, 'outline-import-create'); // 确认创建 // 确认创建
    expect(createWorkMock).toHaveBeenCalledTimes(1);
    const arg = createWorkMock.mock.calls[0]?.[0];
    expect(arg?.title).toBe('穿成嫡出大小姐的日常');
    expect(arg?.mode).toBe('novel');
    expect(arg?.settings?.chapterOutlines).toEqual([
      { index: 1, title: '落地嫡长', plot: '胎穿。' },
      { index: 2, title: '私囤', plot: '囤积。' },
      { index: 3, title: '启蒙', plot: '碾压。' },
    ]);
    expect(arg?.settings?.pastedOutline).toBe(THREE_CHAPTERS);
  });

  it('空书名：拦截并发提示，不发起创建', async () => {
    const c = await mount(THREE_CHAPTERS);
    await click(c, 'outline-import-expand'); // 展开
    const input = c.querySelector<HTMLInputElement>('input[aria-label="书名"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input!, '');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(c, 'outline-import-create'); // 确认创建
    expect(c.textContent).toContain('请输入书名');
    expect(createWorkMock).not.toHaveBeenCalled();
  });

  it('创建失败：展示错误文案并可重试', async () => {
    createWorkMock.mockRejectedValueOnce(new Error('书架已满'));
    const c = await mount(THREE_CHAPTERS);
    await click(c, 'outline-import-expand'); // 展开
    await click(c, 'outline-import-create'); // 确认创建
    expect(c.textContent).toContain('书架已满');
  });

  it('反馈⑥时序A：已建资产 ids 随创建一并传入；onCreated 回调携带 workId', async () => {
    const onCreated = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ChapterOutlineImport
            outline={THREE_CHAPTERS}
            suggestedTitle="预填书名"
            characterIds={['char-a', 'char-b']}
            worldbookIds={['wb-1']}
            onCreated={onCreated}
          />
        </MemoryRouter>,
      );
    });
    await click(container, 'outline-import-expand');
    await click(container, 'outline-import-create');
    const arg = createWorkMock.mock.calls[0]?.[0];
    expect(arg?.characterIds).toEqual(['char-a', 'char-b']); // 时序A：创建作品即绑定
    expect(arg?.worldbookIds).toEqual(['wb-1']);
    expect(onCreated).toHaveBeenCalledWith('w-new'); // 向导持久化 workId（时序B锚点）
  });

  it('未传 ids：createWork 以空数组创建（不携带旧资产）', async () => {
    const c = await mount(THREE_CHAPTERS);
    await click(c, 'outline-import-expand');
    await click(c, 'outline-import-create');
    const arg = createWorkMock.mock.calls[0]?.[0];
    expect(arg?.characterIds).toEqual([]);
    expect(arg?.worldbookIds).toEqual([]);
  });
});
