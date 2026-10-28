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
import { Trash2 } from 'lucide-react';
import type { Message } from '@shared/message';
import type { TavernRegexScript } from '@shared/tavern';

import { presentableNovel, splitOutline } from '../../../engine/prompt/postprocess';

import BubbleMarkdown from './BubbleMarkdown';
import OutlineBlock from './OutlineBlock';
import SwipeBar from './SwipeBar';
import { DirectiveBubble } from './DirectiveBubble';

/** 操作条显隐类：触屏常显，桌面 hover/focus 显示 */
const ACTIONS_VISIBLE = 'opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100';

/** 文本编辑区（指令/正文行内编辑共用样式） */
const EDITOR_CLASS =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-2.5 text-sm leading-relaxed outline-none focus:border-[hsl(var(--accent))]';

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
  /** 删除本章（D3）：确认后父级 DELETE 持久化；resolve(false)=失败（气泡已回滚） */
  onDelete?: () => Promise<boolean>;
}

/** 左侧宽气泡：章标题 + markdown 正文 + SwipeBar + 行内编辑 + 删除确认 */
function ChapterBubble({
  message,
  disabled,
  busy,
  buffer,
  regexScripts,
  onSwipe,
  onReroll,
  onEditContent,
  onDelete,
}: ChapterBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  // 显示分离：头部要点提纲折叠展示（默认收起），气泡正文只渲染 body（编辑/复制仍取全文）
  const { outline, body } = splitOutline(presentableNovel(message.content, message.directive));

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

  /** 删除确认 → 父级 DELETE；失败回滚后气泡仍在此处，行内提示 3s */
  async function confirmDelete(): Promise<void> {
    setConfirmingDelete(false);
    const ok = await onDelete?.();
    if (!ok) {
      setDeleteFailed(true);
      window.setTimeout(() => setDeleteFailed(false), 3000);
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
        {/* D3：删除本章入口——内联两段式确认（🗑 → 删除/取消），失败回滚就地提示 */}
        {onDelete && !confirmingDelete && (
          <button
            type="button"
            title="删除本章（连同该章指令与候选）"
            aria-label="删除本章"
            data-testid="delete-btn"
            disabled={disabled}
            onClick={() => setConfirmingDelete(true)}
            className="flex h-9 min-w-9 items-center justify-center rounded px-1.5 text-xs text-[hsl(var(--fg-muted))] transition-colors hover:bg-[hsl(var(--surface))] hover:text-[hsl(var(--danger))] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
        {confirmingDelete && (
          <span className="flex items-center gap-1.5" data-testid="delete-confirm">
            <span className="text-xs text-[hsl(var(--danger))]">删除本章？不可恢复</span>
            <button
              type="button"
              data-testid="delete-confirm-btn"
              onClick={() => void confirmDelete()}
              className="flex h-9 items-center rounded-md bg-[hsl(var(--danger))] px-2.5 text-xs text-white hover:opacity-90"
            >
              删除
            </button>
            <button
              type="button"
              data-testid="delete-cancel-btn"
              onClick={() => setConfirmingDelete(false)}
              className="flex h-9 items-center rounded-md px-2.5 text-xs text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]"
            >
              取消
            </button>
          </span>
        )}
        {deleteFailed && (
          <span role="alert" data-testid="delete-failed-tip" className="text-xs text-[hsl(var(--danger))]">
            删除失败，请重试
          </span>
        )}
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
  /** 删除本章（D3）：父级 DELETE 持久化 + store 回滚；resolve(false)=失败 */
  onDelete?: (message: Message) => Promise<boolean>;
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
  onDelete,
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
          onDelete={onDelete ? () => onDelete(message) : undefined}
        />
      )}
    </div>
  );
}
