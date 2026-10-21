/**
 * 顶栏退出功能测试（D5）：RootPage 渲染退出按钮 → 点击 → POST /api/auth/logout
 * → settingsStore.config 清空（llmPrefs 保留）→ 路由跳 /login；
 * 以及 useLogout hook 的容错语义（服务端不可达也照常本地登出）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RootPage from '../RootPage';
import { useLogout } from '../../hooks/useLogout';
import { useSettingsStore } from '../../stores/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function jsonRes(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

const roots: Root[] = [];
const containers: HTMLDivElement[] = [];

async function render(ui: React.ReactElement): Promise<void> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(ui);
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path === '/api/auth/logout') return jsonRes({ ok: true });
      // Bookshelf / HolidayBanner 等页面级请求兜底：空列表不阻塞渲染
      if (path.startsWith('/api/')) return jsonRes([]);
      throw new Error(`unmocked fetch: ${path}`);
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  for (const c of containers) c.remove();
  containers.length = 0;
  useSettingsStore.getState().setConfig(null);
});

describe('RootPage 顶栏退出（D5）', () => {
  it('渲染「⏻ 退出」按钮；点击后 config 清空（llmPrefs 保留）并跳转 /login', async () => {
    useSettingsStore.getState().setConfig({ ttsBaseUrl: 'http://x' });
    await render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RootPage />} />
          <Route path="/login" element={<p data-testid="login-page">登录页</p>} />
        </Routes>
      </MemoryRouter>,
    );
    const btn = document.querySelector('[data-testid="logout-btn"]');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain('退出');
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const store = useSettingsStore.getState();
    expect(store.config).toBeNull(); // 会话内存态清空
    expect(store.llmPrefs.model).toBeTruthy(); // 设备偏好保留（登出语义=清会话不清偏好）
    expect(document.querySelector('[data-testid="login-page"]')).not.toBeNull(); // 已跳 /login
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST', credentials: 'include' });
  });
});

describe('useLogout hook 容错', () => {
  it('logout 请求失败（网络断开）也照常清 config 并跳 /login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    useSettingsStore.getState().setConfig({ ttsBaseUrl: 'http://x' });
    let logoutFn: (() => Promise<void>) | null = null;
    function Probe(): null {
      logoutFn = useLogout();
      return null;
    }
    await render(
      <MemoryRouter initialEntries={['/work']}>
        <Routes>
          <Route path="/work" element={<Probe />} />
          <Route path="/login" element={<p data-testid="login-page">登录页</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await act(async () => {
      await logoutFn!();
    });
    expect(useSettingsStore.getState().config).toBeNull();
    expect(document.querySelector('[data-testid="login-page"]')).not.toBeNull();
  });
});
