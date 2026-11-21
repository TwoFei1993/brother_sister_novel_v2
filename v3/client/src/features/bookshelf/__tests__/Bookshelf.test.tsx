/**
 * 书架渲染冒烟测试（jsdom + createRoot，无 testing-library 依赖）
 * 覆盖：空态引导文案 / 作品卡片渲染（标题、模式标签、计数）/ 多选与批量入口（Chunk 6）/
 * 进行中徽标（active 轮询命中）
 * API 层模块级 mock，不触网。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { listWorks, type WorkSummary } from '../../../api/works';
import { fetchActiveTasks, type ActiveTask } from '../../../lib/activeTasks';
import Bookshelf from '../Bookshelf';

vi.mock('../../../api/works', () => ({
  listWorks: vi.fn(),
  getWork: vi.fn(),
  updateWorkTitle: vi.fn(),
  createWork: vi.fn(),
  deleteWork: vi.fn(),
}));

vi.mock('../../../lib/activeTasks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchActiveTasks: vi.fn(),
}));

const listWorksMock = vi.mocked(listWorks);
const fetchActiveTasksMock = vi.mocked(fetchActiveTasks);

// React 19 act 环境声明（组件测试基础设施尚薄，暂就地声明；后续组件测试增多再上提 setupFile）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function workSummary(partial: Partial<WorkSummary> & Pick<WorkSummary, 'id' | 'title'>): WorkSummary {
  return { mode: 'novel', genre: 'chuanyue', updatedAt: 1_700_000_000_000, ...partial };
}

function activeTask(workId: string, partial: Partial<ActiveTask> = {}): ActiveTask {
  return {
    id: `task-${workId}`,
    kind: 'novel-chapter',
    workId,
    progressLen: 800,
    done: 2,
    chapterTotal: 5,
    phase: 'generating',
    createdAt: 1,
    ...partial,
  };
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

/** 拉平 active 轮询首拍（effect 内 promise 微任务） */
async function flushPoll(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el).not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  listWorksMock.mockReset();
  fetchActiveTasksMock.mockReset();
  fetchActiveTasksMock.mockResolvedValue([]);
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
    expect(text).toContain('📖 小说');
    expect(text).toContain('🎬 短剧');
    expect(text).toContain('共 2 部');
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

  it('卡片操作按钮语义可辨（审计 H5）：图标+文字与 aria-label，44px 触控目标', async () => {
    listWorksMock.mockResolvedValue([workSummary({ id: 'w1', title: '穿越之兄妹' })]);
    const container = await renderBookshelf();
    const label = (id: string): string | null =>
      container.querySelector(`[data-testid="${id}"]`)?.getAttribute('aria-label') ?? null;
    expect(label('card-continue')).toBe('续写 穿越之兄妹');
    expect(label('card-rename')).toBe('重命名 穿越之兄妹');
    expect(label('card-delete')).toBe('删除 穿越之兄妹');
    for (const id of ['card-continue', 'card-rename', 'card-delete']) {
      const btn = container.querySelector(`[data-testid="${id}"]`)!;
      expect(btn.className).toContain('h-11'); // 44px 触控目标
      expect(btn.textContent).toMatch(/续写|改名|删除/); // 可视短文字（非纯 emoji）
    }
    expect(container.querySelector('[data-testid="card-delete"]')!.className).toContain('danger'); // 删除 danger 描边
  });
});

describe('Bookshelf 多选批量（Chunk 6 Task 6.1）', () => {
  it('多选入口仅小说视图显示（短剧书不可多选：切短剧视图入口消失）', async () => {
    listWorksMock.mockResolvedValue([
      workSummary({ id: 'w1', title: '穿越之兄妹' }),
      workSummary({ id: 'w2', title: '都市短剧', mode: 'duanju' }),
    ]);
    const c = await renderBookshelf();
    expect(c.querySelector('[data-testid="batch-mode-toggle"]')).not.toBeNull();
    await click(c.querySelector('[data-testid="shelf-view-duanju"]'));
    expect(c.querySelector('[data-testid="batch-mode-toggle"]')).toBeNull();
    // 切回小说视图恢复
    await click(c.querySelector('[data-testid="shelf-view-novel"]'));
    expect(c.querySelector('[data-testid="batch-mode-toggle"]')).not.toBeNull();
  });

  it('进入多选：卡片出现 checkbox；点卡片封面为勾选（选中 ≥1 显示底部操作条）', async () => {
    listWorksMock.mockResolvedValue([
      workSummary({ id: 'w1', title: '穿越之兄妹' }),
      workSummary({ id: 'w2', title: '星际迷航' }),
    ]);
    const c = await renderBookshelf();
    await click(c.querySelector('[data-testid="batch-mode-toggle"]'));
    const boxes = c.querySelectorAll('[data-testid="work-select-box"]');
    expect(boxes).toHaveLength(2);
    expect(c.querySelector('[data-testid="batch-bar"]')).toBeNull();
    // 点第一张卡片封面（多选下不再跳书页而是勾选）
    await click(c.querySelector('[aria-label="选择 穿越之兄妹"]'));
    expect(c.querySelector('[data-testid="batch-bar"]')).not.toBeNull();
    expect((c.querySelector('[data-testid="batch-bar"]')!.textContent ?? '')).toContain('同步生成 (1)');
    await click(c.querySelector('[aria-label="选择 星际迷航"]'));
    expect((c.querySelector('[data-testid="batch-bar"]')!.textContent ?? '')).toContain('同步生成 (2)');
    // checkbox aria 状态同步
    expect(c.querySelector('[data-testid="work-select-box"]')!.getAttribute('aria-checked')).toBe('true');
  });

  it('底部操作条「取消」退出多选（checkbox 与操作条消失、选择清空）', async () => {
    listWorksMock.mockResolvedValue([workSummary({ id: 'w1', title: '穿越之兄妹' })]);
    const c = await renderBookshelf();
    await click(c.querySelector('[data-testid="batch-mode-toggle"]'));
    await click(c.querySelector('[aria-label="选择 穿越之兄妹"]'));
    await click(c.querySelector('[data-testid="batch-bar-cancel"]'));
    expect(c.querySelector('[data-testid="batch-bar"]')).toBeNull();
    expect(c.querySelector('[data-testid="work-select-box"]')).toBeNull();
    // 再进入多选：无残留选择
    await click(c.querySelector('[data-testid="batch-mode-toggle"]'));
    expect((c.querySelector('[data-testid="batch-bar"]'))).toBeNull();
  });

  it('「同步生成」打开批量弹窗（所选书目传入）', async () => {
    listWorksMock.mockResolvedValue([
      workSummary({ id: 'w1', title: '穿越之兄妹' }),
      workSummary({ id: 'w2', title: '星际迷航' }),
    ]);
    const c = await renderBookshelf();
    await click(c.querySelector('[data-testid="batch-mode-toggle"]'));
    await click(c.querySelector('[aria-label="选择 穿越之兄妹"]'));
    await click(c.querySelector('[data-testid="batch-bar-generate"]'));
    const dialog = c.querySelector('[data-testid="batch-generate-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain('穿越之兄妹');
    expect(dialog!.textContent).not.toContain('星际迷航');
    await click(dialog!.querySelector('[data-testid="batch-cancel"]'));
    expect(c.querySelector('[data-testid="batch-generate-dialog"]')).toBeNull();
  });

  it('进行中徽标：active 轮询命中的书渲染 第x/y章·phase，未命中的不渲染', async () => {
    listWorksMock.mockResolvedValue([
      workSummary({ id: 'w1', title: '穿越之兄妹' }),
      workSummary({ id: 'w2', title: '星际迷航' }),
    ]);
    fetchActiveTasksMock.mockResolvedValue([
      activeTask('w1', { done: 2, chapterTotal: 5, phase: 'generating' }),
      activeTask('w-elsewhere'),
    ]);
    const c = await renderBookshelf();
    await flushPoll();
    const badges = c.querySelectorAll('[data-testid="work-active-badge"]');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('第2/5章·生成中');
    // 徽标位于 w1 卡片（标题同卡出现）
    expect(badges[0].closest('.group')?.textContent).toContain('穿越之兄妹');
  });

  it('排队中任务（无 phase）徽标显示排队中', async () => {
    listWorksMock.mockResolvedValue([workSummary({ id: 'w1', title: '穿越之兄妹' })]);
    fetchActiveTasksMock.mockResolvedValue([activeTask('w1', { done: 0, chapterTotal: 3, phase: undefined })]);
    const c = await renderBookshelf();
    await flushPoll();
    expect(c.querySelector('[data-testid="work-active-badge"]')!.textContent).toBe('第0/3章·排队中');
  });

  it('active 轮询终态（workId 消失）→ 静默刷新作品列表（不闪加载态）', async () => {
    vi.useFakeTimers();
    listWorksMock.mockResolvedValue([workSummary({ id: 'w1', title: '穿越之兄妹', stats: { chapterCount: 3 } as WorkSummary['stats'] })]);
    fetchActiveTasksMock.mockResolvedValueOnce([activeTask('w1')]);
    const c = await renderBookshelf();
    await flushPoll();
    expect(fetchActiveTasksMock).toHaveBeenCalledTimes(1);
    // 第二拍：任务消失 → 触发 listWorks 静默刷新
    fetchActiveTasksMock.mockResolvedValueOnce([]);
    listWorksMock.mockResolvedValueOnce([workSummary({ id: 'w1', title: '穿越之兄妹', stats: { chapterCount: 5 } as WorkSummary['stats'] })]);
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    await flushPoll();
    expect(listWorksMock).toHaveBeenCalledTimes(2);
    expect(c.textContent).toContain('5 章');
    // 不闪加载态：卡片仍在（书架加载中… 未出现）
    expect(c.textContent).not.toContain('书架加载中');
    vi.useRealTimers();
  });
});
