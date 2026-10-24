/**
 * 路由表（设计 §7.1）：
 * /login 单密码登录；其余路由统一包 AuthGuard（GET /api/auth/check 守卫，失败跳登录）。
 * 页面全部 React.lazy 懒加载（Suspense 兜底），为后续大页面按路由分包。
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';

import { apiFetch } from './api/client';
import { useUserTheme } from './lib/theme';
import { useAuthStore, type AuthUser } from './stores/auth';
import { useSettingsStore, type ConfigDto } from './stores/settings';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RootPage = lazy(() => import('./pages/RootPage'));
const WorkPage = lazy(() => import('./pages/WorkPage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const OutlineWizard = lazy(() => import('./features/misc/OutlineWizard'));
const PlannerPage = lazy(() => import('./features/planner/PlannerPage'));
// 安卓 app 移动端路由树（/m/*，独立于桌面路由；见 discuss/2026-10-22-安卓app设计共识.md）
const MobileShell = lazy(() => import('./features/mobile/MobileShell'));
const MobileBookshelf = lazy(() => import('./features/mobile/create/MobileBookshelf'));
const MobileWork = lazy(() => import('./features/mobile/create/MobileWork'));
const ReadShelf = lazy(() => import('./features/mobile/read/ReadShelf'));
const Reader = lazy(() => import('./features/mobile/read/Reader'));
const CommunityPage = lazy(() => import('./features/mobile/misc/CommunityPage'));
const MePage = lazy(() => import('./features/mobile/misc/MePage'));

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
        // P3.1：身份同样内存态，刷新后补拉（评论署名/角色入口显隐依赖）
        apiFetch<{ user: AuthUser | null }>('/api/auth/me')
          .then((me) => useAuthStore.getState().setUser(me.user))
          .catch(() => {});
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
            <Route path="/planner" element={<PlannerPage />} />
            <Route path="/m" element={<MobileShell />}>
              <Route index element={<Navigate to="/m/create" replace />} />
              <Route path="create" element={<MobileBookshelf />} />
              <Route path="work/:id" element={<MobileWork />} />
              <Route path="read" element={<ReadShelf />} />
              <Route path="read/:id" element={<Reader />} />
              <Route path="community" element={<CommunityPage />} />
              <Route path="me" element={<MePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
