/**
 * 书架封面网格组件（微信读书式，反馈③）：
 * - ShelfBookCover：单书封面卡（bookSkin 题材渐变 + 首字大字，书名在封面下方）
 * - ShelfGroupCard：分组组合封面（2×2 缩小封面拼图 + 组名/本数，点击进入分组）
 * 创作书架与阅读书架共用。
 */
import { bookSkin } from '../bookshelf/genres';

export interface ShelfBook {
  id: string;
  title: string;
  genre: string;
}

/** 单书封面卡：渐变底 + 首字；manage 模式渲染勾选角标；badges 渲染在书名下方 */
export function ShelfBookCover({
  book,
  onClick,
  manage,
  checked,
  badges,
}: {
  book: ShelfBook;
  onClick: () => void;
  manage?: boolean;
  checked?: boolean;
  badges?: string[];
}) {
  const skin = bookSkin(book.genre, book.id);
  return (
    <button
      type="button"
      onClick={onClick}
      data-checked={checked ? 'true' : undefined}
      className="m-press flex flex-col items-center gap-1 text-left"
    >
      <span
        className="relative block aspect-[3/4] w-full overflow-hidden rounded-lg shadow-sm"
        style={{ background: `linear-gradient(160deg, ${skin.from}, ${skin.to})` }}
      >
        <span className="m-serif absolute inset-0 flex items-center justify-center text-4xl text-white/35">
          {book.title.slice(0, 1)}
        </span>
        <span className="absolute inset-x-1 top-1 truncate text-center text-[11px] font-medium leading-4 text-white/90">
          {book.title}
        </span>
        {manage && (
          <span
            className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
              checked ? 'border-white bg-[hsl(var(--accent))] text-white' : 'border-white/70 bg-black/20 text-transparent'
            }`}
          >
            ✓
          </span>
        )}
      </span>
      <span className="w-full truncate px-0.5 text-xs text-[hsl(var(--fg))]" title={book.title}>
        {book.title}
      </span>
      {badges?.map((b) => (
        <span key={b} className="w-full truncate px-0.5 text-start text-[10px] leading-3.5 text-[hsl(var(--fg-muted))]">
          {b}
        </span>
      ))}
    </button>
  );
}

/** 分组组合封面：2×2 缩小封面拼图（取前 4 本）+ 组名/本数，点击进入分组 */
export function ShelfGroupCard({
  tag,
  books,
  onClick,
}: {
  tag: string;
  books: ReadonlyArray<ShelfBook & { badges?: string[] }>;
  onClick: () => void;
}) {
  const four = books.slice(0, 4);
  return (
    <button type="button" onClick={onClick} className="m-press flex flex-col items-center gap-1 text-left" data-testid={`group-card-${tag}`}>
      <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-1 shadow-sm">
        <span className="grid h-full w-full grid-cols-2 grid-rows-2 gap-0.5">
          {[0, 1, 2, 3].map((i) => {
            const b = four[i];
            const skin = b ? bookSkin(b.genre, b.id) : null;
            return (
              <span
                key={i}
                className="flex items-center justify-center overflow-hidden rounded-[3px] text-[11px] text-white/50"
                style={skin ? { background: `linear-gradient(160deg, ${skin.from}, ${skin.to})` } : { background: 'hsl(var(--border-soft))' }}
              >
                {b ? b.title.slice(0, 1) : ''}
              </span>
            );
          })}
        </span>
      </span>
      <span className="w-full truncate px-0.5 text-xs font-medium text-[hsl(var(--fg))]" title={tag}>
        {tag}
      </span>
      <span className="w-full truncate px-0.5 text-start text-[10px] leading-3.5 text-[hsl(var(--fg-muted))]">{books.length} 本</span>
    </button>
  );
}
