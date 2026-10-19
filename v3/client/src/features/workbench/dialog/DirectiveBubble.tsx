/**
 * 指令气泡（自 MessageBubble 拆出，行数规范修复）：
 * 灰色右侧窄气泡展示作者指令，支持「重放」= 改 directive 文本后对目标章节重生成。
 */
import { useState } from 'react';

const ACTIONS_VISIBLE = 'opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100';

/** 文本编辑区（指令/正文行内编辑共用样式） */
const EDITOR_CLASS =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-2.5 text-sm leading-relaxed outline-none focus:border-[hsl(var(--accent))]';


interface DirectiveBubbleProps {
  text: string;
  disabled: boolean;
  busy: boolean;
  /** 确认重放：携带（可能已改）的指令文本，父级 PATCH + swipeRegenerate */
  onReplay: (next: string) => void;
}

/** 灰色右侧窄气泡：作者指令；「重放」= 改 directive 文本后对目标章节重生成 */
export function DirectiveBubble({ text, disabled, busy, onReplay }: DirectiveBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  function startEdit(): void {
    setDraft(text);
    setEditing(true);
  }

  function confirmReplay(): void {
    setEditing(false);
    onReplay(draft.trim());
  }

  return (
    <div className="group flex flex-col items-end" data-testid="directive-bubble">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3.5 py-2 sm:max-w-[70%]">
        {editing ? (
          <div className="w-64 sm:w-80">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              disabled={disabled}
              aria-label="编辑指令"
              data-testid="directive-editor"
              className={EDITOR_CLASS}
              placeholder="修改指令后重写本章"
            />
            <div className="mt-1.5 flex justify-end gap-2">
              <button
                type="button"
                data-testid="directive-cancel"
                className="h-9 rounded-md px-2.5 text-xs text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]"
                onClick={() => setEditing(false)}
              >
                取消
              </button>
              <button
                type="button"
                disabled={disabled || draft.trim() === ''}
                data-testid="directive-confirm"
                className="h-9 rounded-md bg-[hsl(var(--accent))] px-2.5 text-xs text-[hsl(var(--accent-fg))] disabled:opacity-40"
                onClick={confirmReplay}
              >
                重写本章
              </button>
            </div>
          </div>
        ) : (
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-[hsl(var(--fg-muted))]">
            {text}
          </p>
        )}
      </div>
      {!editing && (
        <div className={`mt-0.5 ${ACTIONS_VISIBLE}`}>
          <button
            type="button"
            disabled={disabled || busy}
            title="重放：修改指令后重写本章"
            data-testid="replay-btn"
            onClick={startEdit}
            className="flex h-9 items-center gap-1 rounded-md px-1.5 text-xs text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))] disabled:opacity-40"
          >
            ↻ 重放
          </button>
        </div>
      )}
    </div>
  );
}

