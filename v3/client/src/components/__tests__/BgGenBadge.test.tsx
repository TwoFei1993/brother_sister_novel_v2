/**
 * BgGenBadge 测试（Chunk 6 Task 6.2）：N>0 渲染「⚡后台生成 N 本」/ N=0 不渲染 / 点击跳书架。
 * fetch stub 脚本化 /active；路由跳转以 history 变化断言。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import BgGenBadge from '../BgGenBadge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let activeTasks: unknown[] = [];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path !== '/api/llm/tasks/active') throw new Error(`unmocked fetch: ${path}`);
      return new Response(JSON.stringify({ tasks: activeTasks }), { status: 200 });
    }),
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const roots: Root[] = [];
const containers: HTMLElement[] = [];
let locationPath: string | null = null;

function LocationProbe(): null {
  locationPath = useLocation().pathname;
  return null;
}

async function renderBadge(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/work/w1']}>
        <BgGenBadge />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

beforeEach(() => {
  vi.useFakeTimers();
  activeTasks = [];
  locationPath = null;
  stubFetch();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  containers.forEach((c) => c.remove());
  containers.length = 0;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('BgGenBadge 顶栏后台生成指示', () => {
  it('N>0：渲染「⚡后台生成 N 本」（仅 novel-chapter 计数）', async () => {
    activeTasks = [
      { id: 't1', kind: 'novel-chapter', workId: 'w1', progressLen: 0, done: 1, chapterTotal: 3, createdAt: 1 },
      { id: 't2', kind: 'novel-chapter', workId: 'w2', progressLen: 0, done: 0, chapterTotal: 2, createdAt: 1 },
      { id: 't3', kind: 'llm', label: '大纲', progressLen: 0, done: 0, chapterTotal: 0, createdAt: 1 },
    ];
    const c = await renderBadge();
    await flush();
    const badge = c.querySelector('[data-testid="bg-gen-count"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe('⚡后台生成 2 本');
  });

  it('N=0：不渲染徽标', async () => {
    activeTasks = [];
    const c = await renderBadge();
    await flush();
    expect(c.querySelector('[data-testid="bg-gen-count"]')).toBeNull();
  });

  it('点击徽标 → navigate("/") 回书架', async () => {
    activeTasks = [
      { id: 't1', kind: 'novel-chapter', workId: 'w1', progressLen: 0, done: 1, chapterTotal: 2, createdAt: 1 },
    ];
    const c = await renderBadge();
    await flush();
    await act(async () => {
      c.querySelector('[data-testid="bg-gen-count"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(locationPath).toBe('/');
  });
});
