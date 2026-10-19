/**
 * 路由表（设计 §7.1）：
 * /login 单密码登录；其余路由统一包 AuthGuard（GET /api/auth/check 守卫，失败跳登录）。
 * 页面全部 React.lazy 懒加载（Suspense 兜底），为后续大页面按路由分包。
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';

import { apiFetch } from './api/client';
import { useUserTheme } from './lib/theme';
import { useSettingsStore, type ConfigDto } from './stores/settings';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RootPage = lazy(() => import('./pages/RootPage'));
const WorkPage = lazy(() => import('./pages/WorkPage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const OutlineWizard = lazy(() => import('./features/misc/OutlineWizard'));

function PageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--bg))] text-sm text-[hsl(var(--fg-muted))]">
      加载中…
    </div>
  );
}

/** 登录守卫：check 通过渲染子路由；401/失败跳 /login */
function AuthGuard() {
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    apiFetch('/api/auth/check', { keepOn401: true })
      .then(() => {
        if (!alive) return;
        // config 是会话内存态（原本仅 LoginPage 登录时拉取）：整页刷新后丢失，
        // 导致 TTS 等运行配置失效到下次登录。已登录刷新时补拉一次（失败不阻塞）。
        if (useSettingsStore.getState().config === null) {
          apiFetch<ConfigDto>('/api/config')
            .then((c) => useSettingsStore.getState().setConfig(c))
            .catch(() => {});
        }
        setChecked(true);
      })
      .catch(() => {
        navigate('/login', { replace: true });
      });
    return () => {
      alive = false;
    };
  }, [navigate]);

  return checked ? <Outlet /> : <PageLoading />;
}

/** 全局主题同步：用户固定主题（设置页选择，localStorage 持久化）→ <html data-theme>。
 *  优先级高于 useWorkTheme（后者检测到固定主题时让位，见 lib/theme.ts）。 */
function GlobalTheme() {
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  useUserTheme(uiTheme);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <GlobalTheme />
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AuthGuard />}>
            <Route path="/" element={<RootPage />} />
            <Route path="/work/:id" element={<WorkPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/wizard" element={<OutlineWizard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
