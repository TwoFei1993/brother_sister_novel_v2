/**
 * 单条消息气泡（A 视图，酒馆式对话流，设计 §7.1）
 *
 * 一条消息渲染为 1-2 个气泡：
 * - 指令气泡（灰色右侧窄气泡）：novel=章节消息的 directive 字段 / 独立 user 消息=正文。
 *   操作条「✏️ 重放」：行内改 directive 后对目标章节 swipeRegenerate（追加候选）。
 * - 章节气泡（左侧宽气泡）：章标题 + markdown 正文（§9.3 双层净化）+ SwipeBar
 *   （◀▶ 切候选 / ↻ 重roll / ✏️ 行内编辑正文 / 📋 复制）。
 * - 重生成中（busy）：该章节气泡下方实时预览 buffer。
 * 显隐：触屏端操作条常显；桌面端 hover/focus 显示。
 * markdown 正文渲染（BubbleMarkdown）拆至同目录独立文件（review 规范修复）。
 */
import { useState } from 'react';
import type { Message } from '@shared/message';
import type { TavernRegexScript } from '@shared/tavern';

import { presentable, splitOutline } from '../../../engine/prompt/postprocess';

import BubbleMarkdown from './BubbleMarkdown';
import OutlineBlock from './OutlineBlock';
import SwipeBar from './SwipeBar';

/** 操作条显隐类：触屏常显，桌面 hover/focus 显示 */
const ACTIONS_VISIBLE = 'opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100';

/** 文本编辑区（指令/正文行内编辑共用样式） */
const EDITOR_CLASS =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-2.5 text-sm leading-relaxed outline-none focus:border-[hsl(var(--accent))]';

// ---------- 指令气泡 ----------

interface DirectiveBubbleProps {
  text: string;
  disabled: boolean;
  busy: boolean;
  /** 确认重放：携带（可能已改）的指令文本，父级 PATCH + swipeRegenerate */
  onReplay: (next: string) => void;
}

/** 灰色右侧窄气泡：作者指令；「重放」= 改 directive 文本后对目标章节重生成 */
function DirectiveBubble({ text, disabled, busy, onReplay }: DirectiveBubbleProps) {
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

// ---------- 章节气泡 ----------

interface ChapterBubbleProps {
  message: Message & { chapter: NonNullable<Message['chapter']> };
  disabled: boolean;
  busy: boolean;
  buffer: string;
  regexScripts?: TavernRegexScript[];
  onSwipe?: (delta: 1 | -1) => void;
  onReroll?: () => void;
  onEditContent?: (content: string) => Promise<void>;
}

/** 左侧宽气泡：章标题 + markdown 正文 + SwipeBar + 行内编辑 */
function ChapterBubble({ message, disabled, busy, buffer, regexScripts, onSwipe, onReroll, onEditContent }: ChapterBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  // 显示分离：头部要点提纲折叠展示（默认收起），气泡正文只渲染 body（编辑/复制仍取全文）
  const { outline, body } = splitOutline(presentable(message.content));

  function startEdit(): void {
    setDraft(message.content);
    setEditing(true);
  }

  async function saveEdit(): Promise<void> {
    const next = draft.trim();
    if (next === '' || next === message.content) {
      setEditing(false);
      return;
    }
    setEditing(false);
    await onEditContent?.(next);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      console.warn('[MessageBubble] 复制失败（剪贴板不可用）');
    }
  }

  return (
    <div className="group flex flex-col items-start" data-testid="chapter-bubble">
      <div className="w-full rounded-2xl rounded-bl-sm border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-4 py-3">
        <h3 className="mb-2 text-sm font-semibold" data-testid="chapter-title">
          {message.chapter.title}
        </h3>
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              disabled={disabled}
              aria-label="编辑正文"
              data-testid="content-editor"
              className={EDITOR_CLASS}
            />
            <div className="mt-1.5 flex justify-end gap-2">
              <button
                type="button"
                data-testid="content-cancel"
                className="h-9 rounded-md px-2.5 text-xs text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]"
                onClick={() => setEditing(false)}
              >
                取消
              </button>
              <button
                type="button"
                disabled={disabled || draft.trim() === ''}
                data-testid="content-save"
                className="h-9 rounded-md bg-[hsl(var(--accent))] px-2.5 text-xs text-[hsl(var(--accent-fg))] disabled:opacity-40"
                onClick={() => void saveEdit()}
              >
                保存
              </button>
            </div>
          </div>
        ) : (
          <>
            {outline && <OutlineBlock outline={outline} regexScripts={regexScripts} />}
            <BubbleMarkdown text={body} regexScripts={regexScripts} />
          </>
        )}
        {busy && (
          <div
            data-testid="buffer-preview"
            className="mt-3 animate-pulse rounded-lg border border-dashed border-[hsl(var(--accent))] p-3 opacity-80"
          >
            <BubbleMarkdown text={buffer} regexScripts={regexScripts} />
            <p className="mt-2 flex items-center gap-2 text-xs text-[hsl(var(--accent))]">
              <span className="inline-block h-2 w-2 animate-ping rounded-full bg-[hsl(var(--accent))]" />
              正在重写这一章…
            </p>
          </div>
        )}
      </div>
      <div className={`mt-0.5 flex items-center gap-1.5 ${ACTIONS_VISIBLE}`}>
        <SwipeBar
          index={message.swipeId}
          total={message.swipes.length}
          disabled={disabled}
          busy={busy}
          onSwipe={(d) => onSwipe?.(d)}
          onReroll={() => onReroll?.()}
          onEdit={startEdit}
          onCopy={() => void copy()}
        />
        {copied && (
          <span data-testid="copied-tip" className="text-xs text-[hsl(var(--fg-muted))]">
            已复制
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- 主组件 ----------

export interface MessageBubbleProps {
  message: Message;
  /** 全局生成中：操作禁用 */
  streaming: boolean;
  /** 本消息正在重生成：气泡下方实时预览 buffer */
  busy?: boolean;
  buffer?: string;
  /** 显示轨正则脚本（markdownOnly，WorkViewRouter 按 work 绑定拉取传入） */
  regexScripts?: TavernRegexScript[];
  onSwipe?: (delta: 1 | -1) => void;
  onReroll?: () => void;
  /** 正文编辑保存（父级 PATCH 持久化） */
  onEditContent?: (content: string) => Promise<void>;
  /** 指令重放（父级 PATCH directive + swipeRegenerate） */
  onReplayDirective?: (directive: string) => void;
}

/** 一条消息 = 指令气泡（若有 directive/user 正文）+ 章节气泡（若有 chapter 元数据） */
export default function MessageBubble({
  message,
  streaming,
  busy = false,
  buffer = '',
  regexScripts,
  onSwipe,
  onReroll,
  onEditContent,
  onReplayDirective,
}: MessageBubbleProps) {
  const directiveText = message.role === 'user' ? message.content : message.directive;
  const isChapter = message.role === 'assistant' && message.chapter !== undefined;

  return (
    <div className="space-y-1.5" data-testid="message-bubble">
      {directiveText !== undefined && directiveText !== '' && (
        <DirectiveBubble
          text={directiveText}
          disabled={streaming}
          busy={busy}
          onReplay={(next) => onReplayDirective?.(next)}
        />
      )}
      {isChapter && (
        <ChapterBubble
          message={message as Message & { chapter: NonNullable<Message['chapter']> }}
          disabled={streaming}
          busy={busy}
          buffer={buffer}
          regexScripts={regexScripts}
          onSwipe={onSwipe}
          onReroll={onReroll}
          onEditContent={onEditContent}
        />
      )}
    </div>
  );
}
