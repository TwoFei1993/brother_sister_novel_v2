/**
 * 移动端壳与阅读书架测试（jsdom + createRoot，无 testing-library 依赖）
 * 覆盖：四 tab 渲染与选中态 / 全屏子页（创作中）不渲染 tabbar / ReadShelf 只列已上架书。
 * listWorks 模块级 mock，不触网。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listWorks, type WorkSummary } from '../../../api/works';
import MobileShell from '../MobileShell';
import ReadShelf from '../read/ReadShelf';

vi.mock('../../../api/works', () => ({ listWorks: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];

/** 挂载：element 挂在通配路由下（避免嵌套 Routes 的相对路径解析陷阱） */
async function renderAt(path: string, element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={element} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

afterEach(async () => {
  await act(async () => {
    for (const r of roots) r.unmount();
  });
  for (const c of containers) c.remove();
  roots.length = 0;
  containers.length = 0;
  vi.restoreAllMocks();
});

describe('MobileShell 四 tab 壳', () => {
  it('渲染四个 tab；/m/create 下创作 tab 高亮、Outlet 渲染子页', async () => {
    const c = await renderAt(
      '/m/create',
      <Routes>
        <Route path="/m" element={<MobileShell />}>
          <Route path="create" element={<p>create-pane</p>} />
          <Route path="work/:id" element={<p>work-page</p>} />
          <Route path="*" element={<p>outlet</p>} />
        </Route>
      </Routes>,
    );
    expect(c.querySelector('[data-testid="tab-create"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="tab-read"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="tab-community"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="tab-me"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="tab-create"]')?.className).toContain('text-[hsl(var(--accent))]');
    expect(c.querySelector('[data-testid="mobile-tabbar"]')).not.toBeNull();
    expect(c.textContent).toContain('create-pane');
  });

  it('全屏子页（/m/work/:id）不渲染 tabbar', async () => {
    const c = await renderAt(
      '/m/work/w1',
      <Routes>
        <Route path="/m" element={<MobileShell />}>
          <Route path="work/:id" element={<p>work-page</p>} />
          <Route path="*" element={<p>outlet</p>} />
        </Route>
      </Routes>,
    );
    expect(c.querySelector('[data-testid="mobile-tabbar"]')).toBeNull();
    expect(c.textContent).toContain('work-page');
  });
});

describe('ReadShelf 阅读书架', () => {
  const work = (id: string, published: number): WorkSummary => ({
    id,
    title: `书${id}`,
    mode: 'novel',
    genre: 'hunhe',
    updatedAt: 1,
    stats: { messageCount: 3, chapterCount: 3, charCount: 30, publishedChapterCount: published },
  });

  it('只列 publishedChapterCount>0 的书', async () => {
    vi.mocked(listWorks).mockResolvedValue([work('a', 2), work('b', 0), work('c', 1)]);
    const c = await renderAt('/m/read', <ReadShelf />);
    await vi.waitFor(() => {
      expect(c.querySelectorAll('[data-testid^="read-shelf-item-"]')).toHaveLength(2);
    });
    expect(c.querySelector('[data-testid="read-shelf-item-b"]')).toBeNull();
  });
});
