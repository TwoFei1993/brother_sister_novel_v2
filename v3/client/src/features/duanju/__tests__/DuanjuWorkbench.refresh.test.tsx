/**
 * 短剧工作台的刷新行为（设计共识 2026-11-26 D7 / 3.7 节）：
 * 分区按「作品数据存在」渲染——刷新作品数据不再卸载重挂分区；刷新失败保留分区并提示；
 * 首次加载失败才显示错误页。打开作品时会尝试续跑未完成的流水线。
 * 各分区与进度条替身为占位组件（带挂载 / 卸载计数）。
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DuanjuProject } from '@shared/duanju';
import { newDuanjuProject } from '@shared/duanju';

const mocks = vi.hoisted(() => ({
  mounted: 0,
  unmounts: 0,
  resumePipeline: vi.fn().mockResolvedValue(null),
}));

vi.mock('../script/PipelineStatusBar', () => ({ default: () => null }));
vi.mock('../lib/pipeline/runner', () => ({ resumePipeline: (...args: unknown[]) => mocks.resumePipeline(...args) }));
vi.mock('../script/ScriptPane', () => ({
  default: () => {
    useEffect(() => {
      mocks.mounted += 1;
      return () => {
        mocks.unmounts += 1;
      };
    }, []);
    return null;
  },
}));
vi.mock('../characters/CharactersPane', () => ({ default: () => null }));
vi.mock('../scenes/ScenesPane', () => ({ default: () => null }));
vi.mock('../storyboard/StoryboardPane', () => ({ default: () => null }));
vi.mock('../export/ExportPane', () => ({ default: () => null }));
vi.mock('../assets/AssetLibraryPane', () => ({ default: () => null }));
vi.mock('../lab/LabPane', () => ({ default: () => null }));

import { useDuanjuStore } from '../store';
import DuanjuWorkbench from '../DuanjuWorkbench';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const WID = 'w1';

function project(confirmed = true): DuanjuProject {
  return { ...newDuanjuProject({ targetEpisodes: 3, style: '动漫风', protagonists: '' }, 1), script: { source: 'manual', text: '原文', confirmed, updatedAt: 1 } };
}

async function mount(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<DuanjuWorkbench workId={WID} title="测试短剧" onBack={vi.fn()} />);
  });
  return container;
}

async function setState(next: Partial<ReturnType<typeof useDuanjuStore.getState>>): Promise<void> {
  await act(async () => {
    useDuanjuStore.setState(next);
  });
}

beforeEach(() => {
  mocks.mounted = 0;
  mocks.unmounts = 0;
  mocks.resumePipeline.mockClear();
  useDuanjuStore.setState({ project: null, loading: true, loadError: false, saving: false, conflict: false, load: vi.fn().mockResolvedValue(undefined) });
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
  useDuanjuStore.getState().reset();
});

describe('DuanjuWorkbench 刷新不卸载分区', () => {
  it('首次加载中：显示加载中，分区未挂载；打开作品时尝试续跑流水线', async () => {
    const c = await mount();
    expect(c.textContent).toContain('加载中');
    expect(mocks.mounted).toBe(0);
    expect(mocks.resumePipeline).toHaveBeenCalledWith(WID);
  });

  it('数据到达后分区挂载；刷新作品数据时分区不卸载、不显示加载中', async () => {
    const c = await mount();
    await setState({ project: project(), loading: false });
    expect(mocks.mounted).toBe(1);
    expect(c.textContent).not.toContain('加载中');

    await setState({ loading: true }); // 例如批量出图每张完成后的刷新
    expect(mocks.mounted).toBe(1);
    expect(mocks.unmounts).toBe(0);
    expect(c.textContent).not.toContain('加载中');
    expect(c.querySelector('[data-testid="duanju-refresh-failed"]')).toBeNull();

    await setState({ loading: false });
    expect(mocks.unmounts).toBe(0);
  });

  it('刷新失败但已有数据：保留分区，顶部提示', async () => {
    const c = await mount();
    await setState({ project: project(), loading: false });
    await setState({ loading: true });
    await setState({ loading: false, loadError: true });
    expect(mocks.unmounts).toBe(0);
    expect(c.querySelector('[data-testid="duanju-refresh-failed"]')?.textContent).toContain('刷新失败');
    expect(c.querySelector('[data-testid="duanju-tab-script"]')).not.toBeNull();
    expect(c.textContent).not.toContain('短剧项目加载失败');
  });

  it('首次加载失败（没有数据）：显示错误页，分区不挂载', async () => {
    const c = await mount();
    await setState({ loading: false, loadError: true });
    expect(c.textContent).toContain('短剧项目加载失败');
    expect(mocks.mounted).toBe(0);
  });

  it('分区多了横向溢出时隐藏滚动条；试验分区不受定稿锁', async () => {
    const c = await mount();
    await setState({ project: project(false), loading: false });
    const nav = c.querySelector('nav[aria-label="短剧分区"]');
    expect(nav?.className).toContain('scrollbar-none');
    expect(c.querySelector('[data-testid="duanju-tab-lab"]')?.hasAttribute('disabled')).toBe(false);
    expect(c.querySelector('[data-testid="duanju-tab-storyboard"]')?.hasAttribute('disabled')).toBe(true);
    await setState({ project: project(true) });
    expect(c.querySelector('[data-testid="duanju-tab-storyboard"]')?.hasAttribute('disabled')).toBe(false);
  });
});
