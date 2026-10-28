/**
 * 移动端壳（安卓 app，/m/* 独立路由树）：底部四 tab + Outlet
 *
 * - 四 tab：创作 / 阅读 / 沟通 / 我的（对应 /m/create、/m/read、/m/community、/m/me）
 * - 独立于桌面路由树：桌面页面与组件零改动（共识 D2 + 「不影响现有网站」约束）
 * - 创作中（/m/work/:id）与阅读页（/m/read/:id）不显示 tab（全屏沉浸），由壳按路径判断
 * - 视觉：纸墨书房（.m-shell 纸纹氛围；tab 选中=衬线字 + 朱砂印点，见 index.css 移动端段）
 */
import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BookMarked, Feather, MessageCircle, UserRound } from 'lucide-react';

import { useAuthStore } from '../../stores/auth';
import { useSettingsStore } from '../../stores/settings';

/** 图标走 lucide 线性 SVG：随主题变色（emoji 无法跟随墨玉/宣纸换肤），跨平台渲染一致 */
const ALL_TABS = [
  { to: '/m/create', label: '创作', icon: Feather, authorOnly: true },
  { to: '/m/read', label: '阅读', icon: BookMarked, authorOnly: false },
  { to: '/m/community', label: '沟通', icon: MessageCircle, authorOnly: false },
  { to: '/m/me', label: '我的', icon: UserRound, authorOnly: false },
] as const;

/** 全屏子页（无底部 tab）：创作中与阅读页 */
const FULLSCREEN_PREFIXES = ['/m/work/', '/m/read/'];

export default function MobileShell() {
  const { pathname } = useLocation();
  const isReader = useAuthStore((s) => s.user?.role === 'reader');
  const fullscreen = FULLSCREEN_PREFIXES.some((p) => pathname.startsWith(p));
  // P3.1：读者 tab 隐藏创作域（服务端已 403 兜底，此处纯体验）
  const tabs = ALL_TABS.filter((t) => !t.authorOnly || !isReader);
  // 读者手输/书签直击创作页 → 重定向阅读页
  const navigate = useNavigate();
  useEffect(() => {
    if (isReader && pathname.startsWith('/m/create')) navigate('/m/read', { replace: true });
  }, [isReader, pathname, navigate]);

  // 纸墨书房：容器级基调（默认墨玉 / 可选宣纸）；仅题材主题穿透（business 等遗留值不压制纸墨）
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const GENRE_THEMES = new Set(['chuanyue', 'scifi', 'moshi', 'wuxian', 'xuanhuan', 'hunhe']);
  const paperMode =
    uiTheme && GENRE_THEMES.has(uiTheme) ? undefined : uiTheme === 'm-paper' ? 'm-paper' : 'm-ink';

  return (
    <div
      className="m-shell flex h-screen flex-col bg-[hsl(var(--bg))] text-[hsl(var(--fg))]"
      data-paper-mode={paperMode}
    >
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {!fullscreen && (
        <nav
          data-testid="mobile-tabbar"
          className="safe-bottom flex shrink-0 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]"
        >
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              data-testid={`tab-${t.to.slice(3)}`}
              data-active={pathname.startsWith(t.to) ? 'true' : 'false'}
              className={({ isActive }) =>
                `m-tab m-rise flex flex-1 flex-col items-center gap-0.5 pb-2.5 pt-2 text-[11px] transition-colors ${
                  isActive ? 'm-serif text-[hsl(var(--accent))]' : 'text-[hsl(var(--fg-muted))]'
                }`
              }
            >
              <t.icon className="h-5 w-5 leading-none" aria-hidden />
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
