/**
 * 题材→主题绑定（Task 32）：作品挂载时按 genre 给 <html> 设 data-theme，
 * 卸载还原默认暗色基调（:root）。CSS 侧 6 套 [data-theme] 变量见 index.css
 * （旧站完整移植）。作品绑定题材即主题，无独立主题开关（ThemeSwitcher 不需要）。
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
 * 作品主题 hook：挂载按 genre 应用，卸载还原默认。
 * WorkPage 挂载点由协调者接入：useWorkTheme(work.genre)。
 */
export function useWorkTheme(genre: string): void {
  useEffect(() => {
    applyWorkTheme(genre);
    return () => resetWorkTheme();
  }, [genre]);
}
