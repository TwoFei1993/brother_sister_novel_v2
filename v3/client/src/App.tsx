/**
 * 路由表（设计 §7.1）：
 * /login 单密码登录；其余路由统一包 AuthGuard（GET /api/auth/check 守卫，失败跳登录）。
 * 页面全部 React.lazy 懒加载（Suspense 兜底），为后续大页面按路由分包。
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';

import { apiFetch } from './api/client';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RootPage = lazy(() => import('./pages/RootPage'));
const WorkPage = lazy(() => import('./pages/Placeholders').then((m) => ({ default: m.WorkPage })));
const LibraryPage = lazy(() =>
  import('./pages/Placeholders').then((m) => ({ default: m.LibraryPage })),
);
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

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
        if (alive) setChecked(true);
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

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AuthGuard />}>
            <Route path="/" element={<RootPage />} />
            <Route path="/work/:id" element={<WorkPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
