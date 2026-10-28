/**
 * 书架页（设计 §7.1）：作品网格入口，登录后默认落地页
 *
 * - 顶栏：站点名 + 资产库 / 大纲向导 / 设置入口（Task 33 移动端一并触控达标）
 * - 节日彩蛋横幅（Task 32）挂在最顶部，关闭后当日不再出现
 */
import { NavLink } from 'react-router-dom';
import { Library, LogOut, ScrollText, Settings } from 'lucide-react';

import Bookshelf from '../features/bookshelf/Bookshelf';
import HolidayBanner from '../features/misc/HolidayBanner';
import { useLogout } from '../hooks/useLogout';

/** 顶栏导航项（当前页高亮；触控目标 h-10）；图标走 lucide 线性 SVG，跨平台渲染一致 */
const NAV_ITEMS: ReadonlyArray<{ to: string; label: string; icon: typeof Library }> = [
  { to: '/library', label: '资产库', icon: Library },
  { to: '/wizard', label: '大纲向导', icon: ScrollText },
  { to: '/settings', label: '设置', icon: Settings },
];

export default function RootPage() {
  const logout = useLogout();
  return (
    <main className="safe-top safe-bottom min-h-screen bg-[hsl(var(--bg))] text-[hsl(var(--fg))]">
      <HolidayBanner />
      <nav
        aria-label="全局导航"
        className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 pb-1 pt-3 sm:pt-4"
      >
        <NavLink to="/" className="min-h-10 font-heading text-lg font-bold tracking-wide" data-testid="nav-home">
          小说工坊
        </NavLink>
        <div className="flex items-center gap-1 sm:gap-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs text-[hsl(var(--fg-muted))] transition-colors hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--fg))] sm:text-sm"
            >
              <item.icon className="h-4 w-4" aria-hidden />
              {item.label}
            </NavLink>
          ))}
          {/* 退出（D5）：POST logout 清服务端 cookie + 本地会话态，跳 /login */}
          <button
            type="button"
            data-testid="logout-btn"
            onClick={() => void logout()}
            title="退出登录"
            aria-label="退出登录"
            className="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs text-[hsl(var(--fg-muted))] transition-colors hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--fg))] sm:text-sm"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            退出
          </button>
        </div>
      </nav>
      <Bookshelf />
    </main>
  );
}
