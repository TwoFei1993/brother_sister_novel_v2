/**
 * 底部阅读菜单：上一章 | 进度滑块（听书=段落进度可拖跳段；未播=章节进度） + 字号/行距设置。
 * 由 Reader 传入当前模式数据；字体设置持久化 localStorage（reading-font-v1）。
 */
import { FileText, List } from 'lucide-react';

/** 正文字体设置（字号 px / 行距倍数） */
export interface ReaderFont {
  size: number;
  lineHeight: number;
}

const FONT_KEY = 'reading-font-v1';
export const DEFAULT_FONT: ReaderFont = { size: 16, lineHeight: 2 };

export function loadFont(): ReaderFont {
  try {
    const raw = JSON.parse(localStorage.getItem(FONT_KEY) ?? '') as Partial<ReaderFont>;
    if (typeof raw.size === 'number' && typeof raw.lineHeight === 'number') {
      return { size: raw.size, lineHeight: raw.lineHeight };
    }
  } catch {
    /* 无记录/损坏用默认 */
  }
  return DEFAULT_FONT;
}

export function saveFont(font: ReaderFont): void {
  try {
    localStorage.setItem(FONT_KEY, JSON.stringify(font));
  } catch {
    /* 隐私模式静默 */
  }
}

interface ReaderMenuProps {
  chapterNo: number;
  lastChapterNo: number;
  chapterIdx: number;
  total: number;
  scrollPct: number;
  onJump: (idx: number) => void;
  onCatalog: () => void;
  onSummary: () => void;
  /** 听书进行中的段落进度（存在即切换滑块为段落模式） */
  tts?: { paraIdx: number; paraTotal: number; onSeek: (i: number) => void };
  font: ReaderFont;
  onFontChange: (patch: Partial<ReaderFont>) => void;
}

export default function ReaderMenu({
  chapterNo,
  lastChapterNo,
  chapterIdx,
  total,
  scrollPct,
  onJump,
  onCatalog,
  onSummary,
  tts,
  font,
  onFontChange,
}: ReaderMenuProps) {
  const paraMode = tts !== undefined && tts.paraTotal > 0;
  return (
    <div
      className="m-sheet safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]/95 px-4 pb-3 pt-3 backdrop-blur-sm"
      data-testid="reader-menu"
    >
      <div className="mb-2 flex items-center justify-between text-xs text-[hsl(var(--fg-muted))]" data-testid="reader-progress">
        <span>
          第 {chapterNo}/{lastChapterNo} 章
        </span>
        <span>{paraMode ? `朗读 ${tts!.paraIdx + 1}/${tts!.paraTotal} 段` : `本章 ${scrollPct}%`}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onJump(chapterIdx - 1)}
          disabled={chapterIdx <= 0}
          data-testid="reader-prev-chapter"
          className="h-9 shrink-0 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs disabled:opacity-40"
        >
          上一章
        </button>
        {paraMode ? (
          <input
            type="range"
            min={0}
            max={tts!.paraTotal - 1}
            value={tts!.paraIdx}
            onChange={(e) => tts!.onSeek(Number(e.target.value))}
            data-testid="reader-progress-slider"
            aria-label="朗读进度"
            className="h-1.5 min-w-0 flex-1 accent-[hsl(var(--accent))]"
          />
        ) : (
          <input
            type="range"
            min={0}
            max={total - 1}
            value={chapterIdx}
            onChange={(e) => onJump(Number(e.target.value))}
            data-testid="reader-progress-slider"
            aria-label="章节进度"
            className="h-1.5 min-w-0 flex-1 accent-[hsl(var(--accent))]"
          />
        )}
        <button
          type="button"
          onClick={() => onJump(chapterIdx + 1)}
          disabled={chapterIdx >= total - 1}
          data-testid="reader-next-chapter"
          className="h-9 shrink-0 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs disabled:opacity-40"
        >
          下一章
        </button>
      </div>

      {/* 字体设置：字号 A-/A+ 与行距循环 */}
      <div className="mt-2 flex items-center gap-2 text-xs text-[hsl(var(--fg-muted))]" data-testid="reader-font-panel">
        <span>字号</span>
        <button
          type="button"
          onClick={() => onFontChange({ size: Math.max(14, font.size - 2) })}
          data-testid="font-smaller"
          className="h-8 w-9 rounded-lg border border-[hsl(var(--border-soft))]"
          aria-label="减小字号"
        >
          A-
        </button>
        <button
          type="button"
          onClick={() => onFontChange({ size: Math.min(26, font.size + 2) })}
          data-testid="font-larger"
          className="h-8 w-9 rounded-lg border border-[hsl(var(--border-soft))]"
          aria-label="增大字号"
        >
          A+
        </button>
        <span className="ml-2">行距</span>
        <button
          type="button"
          onClick={() => onFontChange({ lineHeight: font.lineHeight >= 2.4 ? 1.8 : Math.round((font.lineHeight + 0.3) * 10) / 10 })}
          data-testid="font-lineheight"
          className="h-8 flex-1 rounded-lg border border-[hsl(var(--border-soft))]"
          aria-label="切换行距"
        >
          {font.lineHeight.toFixed(1)}
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onCatalog}
          data-testid="menu-catalog-btn"
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border-soft))] text-xs"
        >
          <List className="h-4 w-4" aria-hidden />
          目录
        </button>
        <button
          type="button"
          onClick={onSummary}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[hsl(var(--border-soft))] text-xs"
        >
          <FileText className="h-4 w-4" aria-hidden />
          评论总结
        </button>
      </div>
    </div>
  );
}
