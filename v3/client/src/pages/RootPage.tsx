/**
 * 书架页（设计 §7.1）：作品网格入口，登录后默认落地页
 *
 * - 顶栏：站点名 + 资产库 / 大纲向导 / 设置入口（Task 33 移动端一并触控达标）
 * - 节日彩蛋横幅（Task 32）挂在最顶部，关闭后当日不再出现
 */
import { NavLink } from 'react-router-dom';

import Bookshelf from '../features/bookshelf/Bookshelf';
import HolidayBanner from '../features/misc/HolidayBanner';

/** 顶栏导航项（当前页高亮；触控目标 h-10） */
const NAV_ITEMS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/library', label: '🗂 资产库' },
  { to: '/wizard', label: '📝 大纲向导' },
  { to: '/settings', label: '⚙ 设置' },
];

export default function RootPage() {
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
              className="flex h-10 items-center rounded-lg px-2.5 text-xs text-[hsl(var(--fg-muted))] transition-colors hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--fg))] sm:text-sm"
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Bookshelf />
    </main>
  );
}
