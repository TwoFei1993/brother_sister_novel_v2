/**
 * 书架渲染冒烟测试（jsdom + createRoot，无 testing-library 依赖）
 * 覆盖：空态引导文案 / 作品卡片渲染（标题、模式标签、计数）
 * API 层模块级 mock，不触网。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { listWorks, type WorkSummary } from '../../../api/works';
import Bookshelf from '../Bookshelf';

vi.mock('../../../api/works', () => ({
  listWorks: vi.fn(),
  getWork: vi.fn(),
  updateWorkTitle: vi.fn(),
  createWork: vi.fn(),
  deleteWork: vi.fn(),
}));

const listWorksMock = vi.mocked(listWorks);

// React 19 act 环境声明（组件测试基础设施尚薄，暂就地声明；后续组件测试增多再上提 setupFile）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function workSummary(partial: Partial<WorkSummary> & Pick<WorkSummary, 'id' | 'title'>): WorkSummary {
  return { mode: 'novel', genre: 'chuanyue', updatedAt: 1_700_000_000_000, ...partial };
}

const roots: Root[] = [];
const containers: HTMLElement[] = [];

async function renderBookshelf(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Bookshelf />
      </MemoryRouter>,
    );
  });
  return container;
}

beforeEach(() => {
  listWorksMock.mockReset();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  containers.length = 0;
  document.body.innerHTML = '';
});

describe('Bookshelf', () => {
  it('空书架渲染空态与三步引导（资源中心/向导快捷入口）', async () => {
    listWorksMock.mockResolvedValue([]);
    const container = await renderBookshelf();
    expect(container.textContent).toContain('书架空空如也');
    expect(container.textContent).toContain('新建作品');
    // 三步引导卡与快捷入口（第二轮体验改进）
    const guide = container.querySelector('[data-testid="bookshelf-empty-guide"]');
    expect(guide).not.toBeNull();
    expect(guide!.textContent).toContain('① 到「资源中心」导入或创建角色卡 / 世界书');
    expect(guide!.textContent).toContain('③ 进入写作台，输入剧情方向开始创作');
    const links = [...guide!.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/library?tab=hub', '/wizard']);
  });

  it('渲染作品卡片：标题、模式标签与作品计数', async () => {
    listWorksMock.mockResolvedValue([
      workSummary({ id: 'w1', title: '穿越之兄妹', mode: 'novel', genre: 'chuanyue' }),
      workSummary({ id: 'w2', title: '深夜茶馆', mode: 'chat', genre: 'hunhe' }),
    ]);
    const container = await renderBookshelf();
    const text = container.textContent ?? '';
    expect(text).toContain('穿越之兄妹');
    expect(text).toContain('深夜茶馆');
    expect(text).toContain('互动小说');
    expect(text).toContain('对话写作');
    expect(text).toContain('共 2 部作品');
  });

  it('标题搜索过滤卡片', async () => {
    listWorksMock.mockResolvedValue([
      workSummary({ id: 'w1', title: '穿越之兄妹' }),
      workSummary({ id: 'w2', title: '星际迷航' }),
    ]);
    const container = await renderBookshelf();
    const input = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input).not.toBeNull();
    await act(async () => {
      // 受控组件：用原生 value setter 赋值 + input 事件（React onChange 实际监听 input）
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '星际');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const text = container.textContent ?? '';
    expect(text).toContain('星际迷航');
    expect(text).not.toContain('穿越之兄妹');
  });
});
