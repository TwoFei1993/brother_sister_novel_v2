/**
 * 阅读偏好（B 视图，交互自旧站 ReadingArea 移植）：4 阅读模式 + 4 字号 + 3 行高
 *
 * 偏好存 localStorage（键 v3-reading-prefs），跨会话保持。
 * 阅读模式底色/前景色映射（day 走全局主题变量，其余三档用固定色，与旧站一致）。
 */
import { useCallback, useState } from 'react';

export type ReadingMode = 'day' | 'night' | 'eye' | 'space';

export interface ReadingPrefs {
  mode: ReadingMode;
  fontSize: number;
  lineHeight: string;
}

export const READING_MODES: ReadonlyArray<{ id: ReadingMode; label: string }> = [
  { id: 'day', label: '白天' },
  { id: 'night', label: '夜间' },
  { id: 'eye', label: '护眼' },
  { id: 'space', label: '深空' },
];

export const FONT_SIZES: ReadonlyArray<{ id: number; label: string }> = [
  { id: 14, label: '小' },
  { id: 16, label: '中' },
  { id: 18, label: '大' },
  { id: 22, label: '超大' },
];

export const LINE_HEIGHTS: ReadonlyArray<{ id: string; label: string }> = [
  { id: '1.5', label: '紧凑' },
  { id: '1.8', label: '标准' },
  { id: '2.2', label: '宽松' },
];

/** 各模式底/前景色（day 用主题变量，返回 undefined 由组件走默认） */
export function readingColors(mode: ReadingMode): { bg?: string; fg?: string } {
  switch (mode) {
    case 'night':
      return { bg: 'hsl(0 0% 6%)', fg: 'hsl(0 0% 75%)' };
    case 'eye':
      return { bg: 'hsl(85 30% 88%)', fg: 'hsl(85 20% 20%)' };
    case 'space':
      return { bg: 'hsl(230 30% 6%)', fg: 'hsl(200 60% 80%)' };
    default:
      return {};
  }
}

const STORAGE_KEY = 'v3-reading-prefs';
const DEFAULT_PREFS: ReadingPrefs = { mode: 'day', fontSize: 16, lineHeight: '1.8' };

/** 非法持久化值回退默认（防手改 localStorage 崩界面） */
function clamp(prefs: Partial<ReadingPrefs>): ReadingPrefs {
  const mode = READING_MODES.some((m) => m.id === prefs.mode) ? (prefs.mode as ReadingMode) : DEFAULT_PREFS.mode;
  const size = FONT_SIZES.some((f) => f.id === prefs.fontSize) ? (prefs.fontSize as number) : DEFAULT_PREFS.fontSize;
  const lh = LINE_HEIGHTS.some((l) => l.id === prefs.lineHeight)
    ? (prefs.lineHeight as string)
    : DEFAULT_PREFS.lineHeight;
  return { mode, fontSize: size, lineHeight: lh };
}

export function loadReadingPrefs(): ReadingPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return clamp(JSON.parse(raw) as Partial<ReadingPrefs>);
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveReadingPrefs(prefs: ReadingPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 隐私模式等存储不可用场景静默降级为会话内生效
  }
}

/** 阅读偏好 hook：改任一档即持久化 */
export function useReadingPrefs(): {
  prefs: ReadingPrefs;
  setMode: (mode: ReadingMode) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (lh: string) => void;
} {
  const [prefs, setPrefs] = useState<ReadingPrefs>(loadReadingPrefs);
  const update = useCallback((patch: Partial<ReadingPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveReadingPrefs(next);
      return next;
    });
  }, []);
  return {
    prefs,
    setMode: (mode) => update({ mode }),
    setFontSize: (fontSize) => update({ fontSize }),
    setLineHeight: (lineHeight) => update({ lineHeight }),
  };
}
