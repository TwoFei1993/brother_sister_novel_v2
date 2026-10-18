/**
 * 气泡操作条（A 视图，酒馆 swipe 交互移植）
 *
 * - ◀ n/m ▶：候选切换（父级 updateSwipe 本地 + PATCH 持久化）；仅一支时不渲染箭头
 * - ↻ 重roll：同 directive 再生成，追加候选（重生成中禁用）
 * - ✏️ 编辑：进入行内编辑（textarea 由父组件渲染）
 * - 📋 复制：当前候选文本入剪贴板
 * 显隐：触屏端无 hover，操作条常显；桌面端默认淡显，hover/focus 完全不透明。
 */
interface SwipeBarProps {
  /** 当前候选下标（0-based） */
  index: number;
  /** 候选总数 */
  total: number;
  /** 全局生成中：切换/编辑/复制禁用 */
  disabled?: boolean;
  /** 本消息重生成中：重roll 禁用 */
  busy?: boolean;
  onSwipe: (delta: 1 | -1) => void;
  onReroll: () => void;
  onEdit: () => void;
  onCopy: () => void;
}

const barBtn =
  'flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-xs text-[hsl(var(--fg-muted))] transition-colors hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--fg))] disabled:cursor-not-allowed disabled:opacity-40';

export default function SwipeBar({
  index,
  total,
  disabled = false,
  busy = false,
  onSwipe,
  onReroll,
  onEdit,
  onCopy,
}: SwipeBarProps) {
  return (
    <div data-testid="swipe-bar" className="flex items-center gap-0.5">
      {total > 1 && (
        <div className="flex items-center rounded-lg border border-[hsl(var(--border-soft))]">
          <button
            type="button"
            title="上一支"
            aria-label="上一支"
            disabled={disabled}
            data-testid="swipe-left"
            onClick={() => onSwipe(-1)}
            className={`${barBtn} h-7`}
          >
            ◀
          </button>
          <span data-testid="swipe-count" className="min-w-8 text-center text-xs text-[hsl(var(--fg-muted))]">
            {index + 1}/{total}
          </span>
          <button
            type="button"
            title="下一支"
            aria-label="下一支"
            disabled={disabled}
            data-testid="swipe-right"
            onClick={() => onSwipe(1)}
            className={`${barBtn} h-7`}
          >
            ▶
          </button>
        </div>
      )}
      <button
        type="button"
        title="重roll：同指令再写一支（追加候选）"
        aria-label="重roll"
        disabled={disabled || busy}
        data-testid="reroll-btn"
        onClick={onReroll}
        className={barBtn}
      >
        ↻
      </button>
      <button
        type="button"
        title="编辑本章"
        aria-label="编辑本章"
        disabled={disabled}
        data-testid="edit-btn"
        onClick={onEdit}
        className={barBtn}
      >
        ✏️
      </button>
      <button
        type="button"
        title="复制本章"
        aria-label="复制本章"
        disabled={disabled}
        data-testid="copy-btn"
        onClick={onCopy}
        className={barBtn}
      >
        📋
      </button>
    </div>
  );
}
