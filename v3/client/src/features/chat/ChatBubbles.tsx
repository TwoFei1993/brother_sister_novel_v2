/**
 * chat 气泡子组件（自 ChatView 拆出，保持视图文件行数指标）
 *
 * - UserBubble：用户气泡（右侧；pendingText 待入库气泡复用，testid 可覆盖）
 * - MessageBubble：assistant 气泡（左侧）+ swipe 切换 / 重roll / 朗读操作
 * 展示为纯文本（whitespace-pre-wrap）；markdown+DOMPurify 渲染由视图接线任务统一接入。
 */
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
  onSwipe,
  onRegenerate,
  onSpeak,
}: {
  message: { role: string; name?: string; content: string; id: string; swipes: string[]; swipeId: number };
  canSwipe: boolean;
  canRegenerate: boolean;
  onSwipe?: (messageId: string, dir: 1 | -1) => void;
  onRegenerate?: (messageId: string) => void;
  onSpeak?: (content: string) => void;
}) {
  if (message.role === 'user') {
    return <UserBubble name={message.name} content={message.content} />;
  }
  const content = message.swipes[message.swipeId] ?? message.content;
  return (
    <div className="flex justify-start" data-testid="chat-bubble" data-side="left" data-name={message.name}>
      <Avatar name={message.name ?? ''} />
      <div className="ml-2 max-w-[80%]">
        <p className="mb-0.5 text-xs text-[hsl(var(--fg-muted))]">{message.name}</p>
        <div className="rounded-2xl rounded-tl-sm bg-[hsl(var(--surface))] px-3 py-2 text-sm whitespace-pre-wrap">{content}</div>
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
