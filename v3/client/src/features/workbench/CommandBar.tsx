/**
 * 底部指挥条（B 视图，设计 §7.1）：指令输入 + ▶续写 + 🎲换一支 +「继续」/ 停止
 *
 * - ▶续写：指令可空（空 = 无剧情指令自由续写）
 * - 🎲换一支：最后一章多候选时 ◀▶ 切换（PATCH swipeId）；仅一支时 = swipe 重生成（追加候选）
 * -「继续」：断流/停止后 partialKept=true 出现，以半成品重组上下文再发起（§9.2）
 * - 生成中：▶ 变 ⏹ 停止；输入与换一支禁用
 */
import { useState, type KeyboardEvent } from 'react';

interface CommandBarProps {
  streaming: boolean;
  /** 断流/停止后已产出部分保留，「继续」可用 */
  partialKept: boolean;
  /** 最后一章候选数 >1（可 ◀▶ 切换；false 时 🎲 走重生成） */
  canToggleSwipe: boolean;
  /** 候选位置显示，如 "2/3"；无章节为 null */
  swipePosition: string | null;
  /** 作品未加载完成时整体禁用 */
  disabled: boolean;
  /** 换一支动作进行中（重生成期间 🎲 禁用） */
  busy: boolean;
  onGenerate: (directive: string) => void;
  onToggleSwipe: (delta: 1 | -1) => void;
  onContinue: () => void;
  onStop: () => void;
}

const btnBase =
  'flex h-10 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40';

export default function CommandBar({
  streaming,
  partialKept,
  canToggleSwipe,
  swipePosition,
  disabled,
  busy,
  onGenerate,
  onToggleSwipe,
  onContinue,
  onStop,
}: CommandBarProps) {
  const [directive, setDirective] = useState('');

  function submit(): void {
    if (disabled || streaming) return;
    onGenerate(directive.trim());
    setDirective('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
  }

  return (
    <div className="safe-bottom border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-2 py-2 sm:px-4">
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            data-testid="stop-btn"
            className={`${btnBase} flex-1 bg-[hsl(var(--danger))] text-white sm:flex-none sm:px-6`}
          >
            ⏹ 停止
          </button>
        ) : (
          <>
            <input
              type="text"
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder="剧情指令（可空，如：兄妹进入遗迹深处…）"
              aria-label="剧情指令"
              data-testid="directive-input"
              className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))] disabled:opacity-40"
            />
            <button
              type="button"
              onClick={submit}
              disabled={disabled || busy}
              data-testid="generate-btn"
              className={`${btnBase} bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]`}
            >
              ▶ 续写
            </button>
            {canToggleSwipe ? (
              <div className="flex h-10 shrink-0 items-center rounded-lg border border-[hsl(var(--border-soft))]">
                <button
                  type="button"
                  title="上一支"
                  disabled={disabled}
                  onClick={() => onToggleSwipe(-1)}
                  className="h-full rounded-l-lg px-2.5 text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))] disabled:opacity-40"
                >
                  ◀
                </button>
                <span data-testid="swipe-position" className="min-w-10 text-center text-xs text-[hsl(var(--fg-muted))]">
                  {swipePosition ?? ''}
                </span>
                <button
                  type="button"
                  title="下一支"
                  disabled={disabled}
                  onClick={() => onToggleSwipe(1)}
                  className="h-full rounded-r-lg px-2.5 text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))] disabled:opacity-40"
                >
                  ▶
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onToggleSwipe(1)}
                disabled={disabled || busy}
                title="换一支：同指令重新生成本章"
                data-testid="swipe-btn"
                className={`${btnBase} border border-[hsl(var(--border-soft))] text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]`}
              >
                🎲 换一支
              </button>
            )}
          </>
        )}
        {!streaming && partialKept && (
          <button
            type="button"
            onClick={onContinue}
            data-testid="continue-btn"
            className={`${btnBase} bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]`}
          >
            继续
          </button>
        )}
      </div>
    </div>
  );
}
