/**
 * chat 气泡子组件（自 ChatView 拆出，保持视图文件行数指标）
 *
 * - UserBubble：用户气泡（右侧；pendingText 待入库气泡复用，testid 可覆盖）
 * - MessageBubble：assistant 气泡（左侧）+ swipe 切换 / 重roll / 朗读操作
 * - BubbleMarkdown：assistant 正文 markdown 渲染（审计 H1 接线：与 novel 侧同款
 *   管道——presentable → applyDisplayRegex → DOMPurify → rehype-sanitize；气泡是
 *   小容器，排版用简化 prose（紧凑段距 + 列表缩进），不套 ReadingView 的长文样式）
 */
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import type { TavernRegexScript } from '@shared/tavern';

import { presentable } from '../../engine/prompt/postprocess';
import { applyDisplayRegex } from '../../lib/reading/markdown';
import { sanitizeMarkdownSource } from '../../lib/sanitize';

import { avatarChar } from './MemberBar';

export function Avatar({ name }: { name: string }) {
  return (
    <span
      data-testid="chat-avatar"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent))]/15 text-xs font-semibold text-[hsl(var(--accent))]"
    >
      {avatarChar(name)}
    </span>
  );
}

/** 气泡简化 markdown 排版：紧凑段距/列表缩进/分隔线淡化，随主题变量换肤 */
const BUBBLE_MARKDOWN_CLASS =
  '[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:ps-5 [&_li]:my-0.5 [&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-[hsl(var(--border-soft))] [&_blockquote]:ps-2.5 [&_a]:text-[hsl(var(--accent))] [&_a]:underline [&_hr]:my-2 [&_hr]:border-[hsl(var(--border-soft))] [&_code]:rounded [&_code]:bg-[hsl(var(--bg))] [&_code]:px-1 [&_code]:text-[0.9em]';

/** chat 气泡 markdown（§9.3 双保险净化 + 显示轨正则；仅 assistant 已入库气泡用） */
export function BubbleMarkdown({ text, regexScripts }: { text: string; regexScripts?: TavernRegexScript[] }) {
  return (
    <div className={BUBBLE_MARKDOWN_CLASS}>
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
        {sanitizeMarkdownSource(applyDisplayRegex(text, regexScripts))}
      </ReactMarkdown>
    </div>
  );
}

export function UserBubble({ name, content, testid = 'chat-bubble' }: { name?: string; content: string; testid?: string }) {
  return (
    <div className="flex justify-end" data-testid={testid} data-side="right" data-name={name}>
      <div className="max-w-[80%]">
        <p className="mb-0.5 text-right text-xs text-[hsl(var(--fg-muted))]">{name}</p>
        <div className="rounded-2xl rounded-br-sm bg-[hsl(var(--accent))] px-3 py-2 text-sm whitespace-pre-wrap text-[hsl(var(--accent-fg))]">
          {content}
        </div>
      </div>
    </div>
  );
}

export function MessageBubble({
  message,
  canSwipe,
  canRegenerate,
  regexScripts,
  memberNames,
  onSwipe,
  onRegenerate,
  onSpeak,
}: {
  message: { role: string; name?: string; content: string; id: string; swipes: string[]; swipeId: number };
  canSwipe: boolean;
  canRegenerate: boolean;
  /** 显示轨正则脚本（markdownOnly，work 绑定资产；与 novel 视图同源） */
  regexScripts?: TavernRegexScript[];
  memberNames?: string[];
  onSwipe?: (messageId: string, dir: 1 | -1) => void;
  onRegenerate?: (messageId: string) => void;
  onSpeak?: (content: string) => void;
}) {
  if (message.role === 'user') {
    return <UserBubble name={message.name} content={message.content} />;
  }
  // 显示时净化：旧数据的思维流/预设片段/名字前缀等残留（生成时的净化只覆盖新消息）
  const content = presentable(
    message.swipes[message.swipeId] ?? message.content,
    message.name,
    memberNames,
  );
  return (
    <div className="flex justify-start" data-testid="chat-bubble" data-side="left" data-name={message.name}>
      <Avatar name={message.name ?? ''} />
      <div className="ml-2 max-w-[80%]">
        <p className="mb-0.5 text-xs text-[hsl(var(--fg-muted))]">{message.name}</p>
        <div className="rounded-2xl rounded-tl-sm bg-[hsl(var(--surface))] px-3 py-2 text-sm">
          <BubbleMarkdown text={content} regexScripts={regexScripts} />
        </div>
        {(canSwipe || canRegenerate || onSpeak) && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-[hsl(var(--fg-muted))]">
            {canSwipe && (
              <span className="flex items-center gap-1" data-testid="chat-swipe-controls">
                <button
                  type="button"
                  title="上一支"
                  data-testid="swipe-left"
                  onClick={() => onSwipe?.(message.id, -1)}
                  className="flex h-9 min-w-9 items-center justify-center hover:text-[hsl(var(--fg))]"
                >
                  ◀
                </button>
                <span data-testid="swipe-position">
                  {message.swipeId + 1}/{message.swipes.length}
                </span>
                <button
                  type="button"
                  title="下一支"
                  data-testid="swipe-right"
                  onClick={() => onSwipe?.(message.id, 1)}
                  className="flex h-9 min-w-9 items-center justify-center hover:text-[hsl(var(--fg))]"
                >
                  ▶
                </button>
              </span>
            )}
            {canRegenerate && (
              <button
                type="button"
                title="重新生成本条"
                data-testid="regen-btn"
                onClick={() => onRegenerate?.(message.id)}
                className="flex h-9 items-center px-1 hover:text-[hsl(var(--fg))]"
              >
                ↻ 重roll
              </button>
            )}
            {onSpeak && (
              <button
                type="button"
                title="朗读本条"
                aria-label={`朗读 ${message.name} 的消息`}
                data-testid="speak-btn"
                onClick={() => onSpeak(content)}
                className="flex h-9 min-w-9 items-center justify-center hover:text-[hsl(var(--fg))]"
              >
                🔊
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
