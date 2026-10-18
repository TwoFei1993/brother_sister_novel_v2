/**
 * 酒馆式对话视图（设计 §7.1 chat 模式 / §4.3 激活策略）
 *
 * 纯展示 + 回调组件：生成逻辑不在本组件（父层调 useChatGenerate，Task 23 的
 * useChatGenerate.ts），视图只经 props 回调与外部集成。
 *
 * 集成契约（协调者接线时遵循）：
 * - onSend(text)：父层 pickSpeaker 激活角色 → useChatGenerate.sendMessage(text, speaker)
 * - onPick(id)：父层更新 manualPickId（ChatView 内 MemberBar 已处理「再点取消」语义）
 * - onSwipe(messageId, dir) / onRegenerate(messageId)：父层切换 swipeId（PATCH）/ swipe 重生成
 * - 流式中生成者 = pickSpeaker(members, lastSpeakerId, 刚发送文本, manualPickId)，
 *   刚发送文本由本组件 pendingText 暂存（发送时记录、streaming 结束清除），
 *   无 pendingText 时回退消息流中最后一条 user 消息
 * - 展示为纯文本（whitespace-pre-wrap）；markdown+DOMPurify 渲染由视图接线任务统一接入
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Message } from '@shared/message';

import { pickSpeaker, type ChatMember } from '../../engine/prompt/activation';
import MemberBar, { avatarChar } from './MemberBar';

export interface ChatViewProps {
  messages: Message[];
  members: ChatMember[];
  lastSpeakerId: string | null;
  manualPickId: string | null;
  onSend: (text: string) => void;
  onPick: (id: string | null) => void;
  streaming?: boolean;
  buffer?: string;
  onSwipe?: (messageId: string, dir: 1 | -1) => void;
  onRegenerate?: (messageId: string) => void;
}

export default function ChatView({
  messages,
  members,
  lastSpeakerId,
  manualPickId,
  onSend,
  onPick,
  streaming = false,
  buffer = '',
  onSwipe,
  onRegenerate,
}: ChatViewProps) {
  const [draft, setDraft] = useState('');
  const [pendingText, setPendingText] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  // 流式结束（成功或中断）清除本地暂存的刚发送文本（已入库消息接管展示）
  useEffect(() => {
    if (!streaming) setPendingText('');
  }, [streaming]);

  // 新消息/流式增量时滚到底部（jsdom 无 scrollIntoView，可选调用兜底）
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, buffer]);

  // 流式生成者（§4.3 激活策略）：优先刚发送文本的提及检测
  const streamingSpeakerName = useMemo(() => {
    if (!streaming || members.length === 0) return null;
    const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    return pickSpeaker(members, lastSpeakerId, pendingText || lastUserText, manualPickId).name;
  }, [streaming, members, messages, lastSpeakerId, manualPickId, pendingText]);

  function submit(): void {
    const text = draft.trim();
    if (!text || streaming) return;
    onSend(text);
    setPendingText(text);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-view">
      <MemberBar members={members} lastSpeakerId={lastSpeakerId} manualPickId={manualPickId} onPick={onPick} streaming={streaming} />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="chat-list">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.length === 0 && !pendingText && (
            <p className="mt-8 text-center text-sm text-[hsl(var(--fg-muted))]" data-testid="chat-empty">
              开始对话吧——输入消息，或点上方成员指定下一位发言者
            </p>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              canSwipe={Boolean(onSwipe) && m.swipes.length > 1}
              canRegenerate={Boolean(onRegenerate)}
              onSwipe={onSwipe}
              onRegenerate={onRegenerate}
            />
          ))}
          {pendingText && <UserBubble name="用户" content={pendingText} testid="chat-pending-bubble" />}
          {streaming && (
            <div className="flex justify-start" data-testid="chat-streaming-bubble">
              <Avatar name={streamingSpeakerName ?? ''} />
              <div className="ml-2 max-w-[80%]">
                <p className="mb-0.5 text-xs text-[hsl(var(--fg-muted))]">{streamingSpeakerName ?? '…'}</p>
                <div className="rounded-2xl rounded-tl-sm bg-[hsl(var(--surface))] px-3 py-2 text-sm whitespace-pre-wrap">
                  {buffer || <span className="animate-pulse">…</span>}
                </div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="safe-bottom border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-2 py-2 sm:px-4">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            placeholder={streaming ? '生成中…' : '输入消息…'}
            aria-label="对话输入"
            data-testid="chat-input"
            className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))] disabled:opacity-40"
          />
          <button
            type="button"
            onClick={submit}
            disabled={streaming || !draft.trim()}
            data-testid="chat-send"
            className="flex h-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 气泡子组件（本文件内私有） ----------

function Avatar({ name }: { name: string }) {
  return (
    <span
      data-testid="chat-avatar"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent))]/15 text-xs font-semibold text-[hsl(var(--accent))]"
    >
      {avatarChar(name)}
    </span>
  );
}

function UserBubble({ name, content, testid = 'chat-bubble' }: { name: string; content: string; testid?: string }) {
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

function MessageBubble({
  message,
  canSwipe,
  canRegenerate,
  onSwipe,
  onRegenerate,
}: {
  message: Message;
  canSwipe: boolean;
  canRegenerate: boolean;
  onSwipe?: (messageId: string, dir: 1 | -1) => void;
  onRegenerate?: (messageId: string) => void;
}) {
  if (message.role === 'user') {
    return <UserBubble name={message.name} content={message.content} />;
  }
  const content = message.swipes[message.swipeId] ?? message.content;
  return (
    <div className="flex justify-start" data-testid="chat-bubble" data-side="left" data-name={message.name}>
      <Avatar name={message.name} />
      <div className="ml-2 max-w-[80%]">
        <p className="mb-0.5 text-xs text-[hsl(var(--fg-muted))]">{message.name}</p>
        <div className="rounded-2xl rounded-tl-sm bg-[hsl(var(--surface))] px-3 py-2 text-sm whitespace-pre-wrap">{content}</div>
        {(canSwipe || canRegenerate) && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-[hsl(var(--fg-muted))]">
            {canSwipe && (
              <span className="flex items-center gap-1" data-testid="chat-swipe-controls">
                <button type="button" title="上一支" data-testid="swipe-left" onClick={() => onSwipe?.(message.id, -1)} className="hover:text-[hsl(var(--fg))]">
                  ◀
                </button>
                <span data-testid="swipe-position">
                  {message.swipeId + 1}/{message.swipes.length}
                </span>
                <button type="button" title="下一支" data-testid="swipe-right" onClick={() => onSwipe?.(message.id, 1)} className="hover:text-[hsl(var(--fg))]">
                  ▶
                </button>
              </span>
            )}
            {canRegenerate && (
              <button type="button" title="重新生成本条" data-testid="regen-btn" onClick={() => onRegenerate?.(message.id)} className="hover:text-[hsl(var(--fg))]">
                ↻ 重roll
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
