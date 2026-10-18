/**
 * 快速指令 + 指令历史（C 工作台侧栏，设计 §7.1）
 *
 * - 快速指令区：作品级 quickDirectives（NovelSettings 可选字段）按钮，点击复填到底部
 *   指令输入（onPick）；＋ 号把内联输入框文本追加为快速指令，× 删除（父层 PATCH work）
 * - 指令历史：全部 user 消息（novel 模式的 directive）倒序，点击同样复填
 */
import { useState, type FormEvent } from 'react';

import type { Message } from '@shared/message';

export interface DirectiveHistoryProps {
  messages: Message[];
  /** 点击历史/快速指令：复填到底部指令输入框 */
  onPick: (text: string) => void;
  /** 作品级快速指令（work.settings.quickDirectives） */
  quickDirectives: string[];
  /** 追加快速指令（父层 PATCH work.settings.quickDirectives） */
  onAddQuickDirective: (text: string) => void;
  /** 删除快速指令（按下标） */
  onRemoveQuickDirective: (index: number) => void;
}

/** user 消息倒序（最新指令在最上） */
function directiveList(messages: Message[]): Message[] {
  return messages.filter((m) => m.role === 'user').reverse();
}

export default function DirectiveHistory({
  messages,
  onPick,
  quickDirectives,
  onAddQuickDirective,
  onRemoveQuickDirective,
}: DirectiveHistoryProps) {
  const [draft, setDraft] = useState('');
  const history = directiveList(messages);

  function addQuick(e: FormEvent): void {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onAddQuickDirective(text);
    setDraft('');
  }

  return (
    <section aria-label="指令历史" data-testid="directive-history" className="px-3 py-2">
      {/* 快速指令区 */}
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-[hsl(var(--fg-muted))]">快速指令</h3>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {quickDirectives.map((q, i) => (
          <span
            key={`${q}-${i}`}
            data-testid="quick-directive"
            className="flex min-h-9 items-center overflow-hidden rounded-full border border-[hsl(var(--border-soft))] text-xs"
          >
            <button
              type="button"
              onClick={() => onPick(q)}
              title="点击复填到指令输入"
              className="max-w-40 truncate px-2.5 py-1 transition-colors hover:text-[hsl(var(--accent))]"
            >
              {q}
            </button>
            <button
              type="button"
              onClick={() => onRemoveQuickDirective(i)}
              aria-label={`删除快速指令：${q}`}
              data-testid="remove-quick"
              className="h-full px-1.5 text-[hsl(var(--fg-muted))] transition-colors hover:text-[hsl(var(--danger))]"
            >
              ×
            </button>
          </span>
        ))}
        <form onSubmit={addQuick} className="flex items-center gap-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="新增常用指令"
            aria-label="新快速指令文本"
            data-testid="quick-input"
            className="h-9 w-28 rounded-full border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
          />
          <button
            type="submit"
            aria-label="添加快速指令"
            data-testid="add-quick"
            disabled={!draft.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--border-soft))] text-sm transition-colors hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))] disabled:opacity-40"
          >
            ＋
          </button>
        </form>
      </div>

      {/* 指令历史（倒序） */}
      <h3 className="mb-1 mt-3 text-xs font-semibold tracking-wide text-[hsl(var(--fg-muted))]">
        指令历史
        <span className="ml-1 font-normal">{history.length}</span>
      </h3>
      {history.length === 0 && (
        <p className="py-2 text-xs text-[hsl(var(--fg-muted))]">还没有发送过指令</p>
      )}
      <ul className="space-y-1">
        {history.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => onPick(m.content)}
              data-testid="history-item"
              title="点击复填到指令输入"
              className="min-h-9 w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[hsl(var(--surface))]"
            >
              <span className="block truncate text-xs text-[hsl(var(--fg))]">{m.content}</span>
              <span className="mt-0.5 block text-[10px] text-[hsl(var(--fg-muted))]">
                {new Date(m.createdAt).toLocaleString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
