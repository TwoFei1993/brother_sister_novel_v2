/**
 * 书架批量 UI 小组件（Chunk 6 Task 6.1）：顶部多选入口 + 底部操作条。
 * 独立成文件：Bookshelf 只挂载不内联 JSX（300 行约束）。
 */

/** 多选模式入口（仅小说视图挂载）：文案随模式切换，aria-pressed 同步状态 */
export function BatchModeToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="batch-mode-toggle"
      aria-pressed={active}
      onClick={onToggle}
      className={`h-10 rounded-lg border px-4 text-sm font-medium transition-colors ${
        active
          ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
          : 'border-[hsl(var(--border-soft))] hover:border-[hsl(var(--accent))]'
      }`}
    >
      {active ? '退出多选' : '多选'}
    </button>
  );
}

interface BatchActionBarProps {
  count: number;
  onGenerate: () => void;
  onCancel: () => void;
}

export default function BatchActionBar({ count, onGenerate, onCancel }: BatchActionBarProps) {
  return (
    <div
      data-testid="batch-bar"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-4 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]/95 px-4 py-3 backdrop-blur"
    >
      <span className="text-sm text-[hsl(var(--fg-muted))]">已选 {count} 本</span>
      <button
        type="button"
        data-testid="batch-bar-generate"
        onClick={onGenerate}
        disabled={count === 0}
        className="h-10 rounded-lg bg-[hsl(var(--accent))] px-5 text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        同步生成 ({count})
      </button>
      <button
        type="button"
        data-testid="batch-bar-cancel"
        onClick={onCancel}
        className="h-10 rounded-lg border border-[hsl(var(--border-soft))] px-5 text-sm transition-colors hover:border-[hsl(var(--accent))]"
      >
        取消
      </button>
    </div>
  );
}
