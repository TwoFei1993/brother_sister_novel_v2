/**
 * 💭 思考折叠块（DeepSeek 式）：流式中默认展开跟随思考，正文开始后自动收起为一行（重roll场景默认收起）。
 */
import { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';

export function ThinkingInline({ text, done, startCollapsed = false }: { text: string; done: boolean; startCollapsed?: boolean }) {
  const [open, setOpen] = useState(!startCollapsed);
  useEffect(() => {
    if (done) setOpen(false);
  }, [done]);
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="mobile-thinking-toggle"
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-[hsl(var(--fg-muted))]"
      >
        <Brain className="h-3.5 w-3.5" aria-hidden />
        {done ? '已深度思考（点击展开）' : '深度思考中…'}
        <span className="ml-auto">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="max-h-56 overflow-y-auto px-3 pb-2 text-xs leading-5 whitespace-pre-wrap text-[hsl(var(--fg-muted))]">
          {text.slice(-2000)}
        </div>
      )}
    </div>
  );
}
