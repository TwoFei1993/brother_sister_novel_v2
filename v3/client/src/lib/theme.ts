/**
 * 题材→主题绑定（Task 32）+ 用户固定主题（第二轮体验改进）
 *
 * - 作品挂载时按 genre 给 <html> 设 data-theme，卸载还原默认暗色基调（:root）
 * - 用户在设置页选定固定主题后全局覆盖（优先级高于 useWorkTheme，
 *   useWorkTheme 检测到 userTheme 时让位）；null = 跟随作品题材
 * CSS 侧 6 套 [data-theme] 变量见 index.css（旧站完整移植）。
 */
import { useEffect } from 'react';

/** 可用主题名（与 index.css 的 [data-theme] 选择器一一对应） */
export type ThemeName = 'chuanyue' | 'scifi' | 'moshi' | 'wuxian' | 'xuanhuan' | 'hunhe';

/** 兜底主题：custom 与未知题材共用"混合类型"（紫金混合氛围最贴近自定义） */
const FALLBACK_THEME: ThemeName = 'hunhe';

/** genre→主题映射表（未知值运行时同样兜底 FALLBACK_THEME） */
const GENRE_THEMES: Readonly<Record<string, ThemeName>> = {
  chuanyue: 'chuanyue',
  scifi: 'scifi',
  moshi: 'moshi',
  wuxian: 'wuxian',
  xuanhuan: 'xuanhuan',
  hunhe: 'hunhe',
  custom: FALLBACK_THEME,
};

const THEME_ATTR = 'data-theme';

/** 用户当前固定主题（null = 跟随作品题材；模块级单例，applyUserTheme 写入） */
let userTheme: string | null = null;

/** 题材对应主题名（custom/未知兜底 hunhe） */
export function themeForGenre(genre: string): ThemeName {
  return GENRE_THEMES[genre] ?? FALLBACK_THEME;
}

/** 立即应用题材主题（可独立调用，如浏览器 console 验证） */
export function applyWorkTheme(genre: string): void {
  document.documentElement.setAttribute(THEME_ATTR, themeForGenre(genre));
}

/** 还原默认主题（移除 data-theme，回落 :root 暗色基调） */
export function resetWorkTheme(): void {
  document.documentElement.removeAttribute(THEME_ATTR);
}

/**
 * 应用用户固定主题：非 null 全局覆盖 data-theme；null = 跟随作品题材
 * （回落到 useWorkTheme / 默认 :root 接管）。
 */
export function applyUserTheme(theme: string | null): void {
  userTheme = theme;
  if (theme) {
    document.documentElement.setAttribute(THEME_ATTR, theme);
  } else {
    document.documentElement.removeAttribute(THEME_ATTR);
  }
}

/** App 级 hook：uiTheme（settingsStore 持久化）变化时同步 DOM。 */
export function useUserTheme(uiTheme: string | null): void {
  useEffect(() => {
    applyUserTheme(uiTheme);
  }, [uiTheme]);
}

/**
 * 作品主题 hook：挂载按 genre 应用，卸载还原默认。
 * 用户选了固定主题时整体让位（不应用、不清除，避免覆盖全局选择）。
 */
export function useWorkTheme(genre: string): void {
  useEffect(() => {
    if (userTheme) return undefined;
    applyWorkTheme(genre);
    return () => {
      if (!userTheme) resetWorkTheme();
    };
  }, [genre]);
}

// ---------- 主题选项元数据（设置页 ThemePanel 色板预览用） ----------

export interface UserThemeOption {
  value: ThemeName;
  /** 中文名 */
  label: string;
  /** 色板预览：页面底色 + 主强调色（HSL 三元组，对应 index.css 变量） */
  swatch: { bg: string; accent: string };
}

/** 6 个可选固定主题（中文名与 genres.ts 题材标签保持一致） */
export const USER_THEME_OPTIONS: ReadonlyArray<UserThemeOption> = [
  { value: 'chuanyue', label: '穿越重生', swatch: { bg: '40 30% 92%', accent: '38 70% 45%' } },
  { value: 'scifi', label: '星际科幻', swatch: { bg: '220 25% 8%', accent: '190 90% 50%' } },
  { value: 'moshi', label: '末世求生', swatch: { bg: '0 0% 10%', accent: '0 70% 50%' } },
  { value: 'wuxian', label: '无限流', swatch: { bg: '260 30% 8%', accent: '270 70% 60%' } },
  { value: 'xuanhuan', label: '玄幻修仙', swatch: { bg: '240 35% 10%', accent: '45 80% 55%' } },
  { value: 'hunhe', label: '混合暗色', swatch: { bg: '260 15% 10%', accent: '45 70% 55%' } },
];
