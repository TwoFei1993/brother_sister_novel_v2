/**
 * A 对话流视图（设计 §7.1 novel A）：酒馆式气泡流容器
 *
 * - 消息逐条渲染 MessageBubble：指令=灰色右侧窄气泡 / 章节=左侧宽气泡（带章标题）
 * - 流式呈现按目标分流：
 *   · 新章节生成（targetId 不在消息流）→ 尾部实时 buffer 气泡
 *   · 重生成/指令重放（targetId 为既有章节）→ 该章节气泡内实时预览
 * - 滚动跟随最新：距底 >300px（用户上滚）暂停自动跟随，滚回底部恢复（scrollTop 判定）
 * - 向上分页同 B 视图：scrollTop<100 触发 onNeedOlder
 * 底部指挥条由 WorkPage 统一复用 CommandBar（一处接线，A/B 视图共享），本组件不重复承载。
 */
import { useEffect, useRef } from 'react';
import type { Message } from '@shared/message';

import MessageBubble, { BubbleMarkdown } from './MessageBubble';

interface DialogViewProps {
  messages: Message[];
  streaming: boolean;
  /** 流式缓冲（生成中实时内容） */
  buffer: string;
  /** 本次生成的目标消息 id：新章节=不在消息流；重生成=既有章节 id */
  targetMessageId: string | null;
  hasMore: boolean;
  loadingOlder: boolean;
  /** scrollTop<100 请求更早消息（§4.6 向上分页） */
  onNeedOlder: () => void;
  /** ◀▶ 切候选（父级 updateSwipe 本地 + PATCH 持久化） */
  onSwipe: (messageId: string, delta: 1 | -1) => void;
  /** ↻ 重roll（同 directive 重生成，追加候选） */
  onReroll: (message: Message) => void;
  /** 正文编辑保存（PATCH 持久化） */
  onEditContent: (message: Message, content: string) => Promise<void>;
  /** 指令重放（PATCH directive + 对目标章节 swipeRegenerate） */
  onReplay: (message: Message, directive: string) => void;
}

export default function DialogView({
  messages,
  streaming,
  buffer,
  targetMessageId,
  hasMore,
  loadingOlder,
  onNeedOlder,
  onSwipe,
  onReroll,
  onEditContent,
  onReplay,
}: DialogViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 滚动跟随：用户主动上滚（距底 >300px）时暂停，重新滚回底部恢复
  const followRef = useRef(true);

  // 流式内容增长时跟随滚动到底（用户上滚期间不打扰）
  useEffect(() => {
    if (!streaming || !followRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [buffer, streaming]);

  function handleScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 300;
    if (el.scrollTop < 100 && hasMore && !loadingOlder && !streaming) onNeedOlder();
  }

  /** 新章节生成中：目标 id 不在消息流 → buffer 渲染为尾部气泡 */
  const tailStreaming = streaming && (targetMessageId === null || !messages.some((m) => m.id === targetMessageId));

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      data-testid="dialog-scroll"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-3 pb-8 pt-4 sm:px-6">
        {hasMore && (
          <p className="py-2 text-center text-xs text-[hsl(var(--fg-muted))]">
            {loadingOlder ? '正在加载更早消息…' : '继续向上滚动加载更早消息'}
          </p>
        )}

        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            streaming={streaming}
            busy={streaming && m.id === targetMessageId}
            buffer={buffer}
            onSwipe={(delta) => onSwipe(m.id, delta)}
            onReroll={() => onReroll(m)}
            onEditContent={(content) => onEditContent(m, content)}
            onReplayDirective={(directive) => onReplay(m, directive)}
          />
        ))}

        {tailStreaming && (
          <div
            data-testid="tail-stream-bubble"
            className="animate-pulse rounded-2xl rounded-bl-sm border border-dashed border-[hsl(var(--accent))] bg-[hsl(var(--surface))] px-4 py-3 opacity-80"
          >
            <BubbleMarkdown text={buffer} />
            <p className="mt-2 flex items-center gap-2 text-xs text-[hsl(var(--accent))]">
              <span className="inline-block h-2 w-2 animate-ping rounded-full bg-[hsl(var(--accent))]" />
              正在生成…
            </p>
          </div>
        )}

        {!streaming && messages.length === 0 && (
          <p className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">还没有对话</p>
        )}
      </div>
    </div>
  );
}
