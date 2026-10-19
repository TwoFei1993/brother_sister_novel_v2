/**
 * 酒馆式对话视图（设计 §7.1 chat 模式 / §4.3 激活策略）
 *
 * 纯展示 + 回调组件：生成逻辑在父层（ChatWorkspace + useChatGenerate），本组件
 * 只经 props 回调与外部集成。onSend(text, opts) 的 opts.implicit=true 为隐式引导
 * （括号 chips：发送但不显示待入库气泡、不入库）。流式生成者 = 父层传入的
 * streamingSpeakerId 优先，未传时回退刚发送文本的提及检测。
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatReplyLength } from '@shared/work';
import type { Message } from '@shared/message';

import { pickSpeaker, type ChatMember } from '../../engine/prompt/activation';
import { Avatar, MessageBubble, UserBubble } from './ChatBubbles';
import MemberBar from './MemberBar';
import { isImplicitDirective } from './chat-directives';

export interface ChatViewProps {
  messages: Message[];
  members: ChatMember[];
  lastSpeakerId: string | null;
  manualPickId: string | null;
  /** opts.implicit=true：隐式引导（括号指令）——发送但不显示待入库气泡、不入库 */
  onSend: (text: string, opts?: { implicit?: boolean }) => void;
  onPick: (id: string | null) => void;
  streaming?: boolean;
  buffer?: string;
  onSwipe?: (messageId: string, dir: 1 | -1) => void;
  onRegenerate?: (messageId: string) => void;
  /** 消息点读（🔊）：宿主接 TTS engine.speakOne */
  onSpeak?: (content: string) => void;
  /** 快速回复 chips（父层按轮次轮换好的一组） */
  quickDirectives?: string[];
  /** 轮换提示 / 长度档 / 自动连播（透传 MemberBar，语义见其文件头） */
  nextSpeakerName?: string;
  replyLength?: ChatReplyLength;
  onReplyLengthChange?: (len: ChatReplyLength) => void;
  autoPlay?: boolean;
  onAutoPlayToggle?: () => void;
  /** 流式生成中的实际激活角色（父层发送时记录；自动连播空引导时消息流反查会取错提及者） */
  streamingSpeakerId?: string | null;
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
  onSpeak,
  quickDirectives = [],
  nextSpeakerName,
  replyLength,
  onReplyLengthChange,
  autoPlay,
  onAutoPlayToggle,
  streamingSpeakerId = null,
}: ChatViewProps) {
  const [draft, setDraft] = useState('');
  const [pendingText, setPendingText] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  /** 移动端软键盘抬起高度（visualViewport 收缩量），垫高输入栏避免被键盘遮挡 */
  const [keyboardInset, setKeyboardInset] = useState(0);

  // 软键盘避让：visualViewport 高度收缩 + 偏移即键盘高度（桌面为 0 不影响布局）
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setKeyboardInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // 流式结束（成功或中断）清除本地暂存的刚发送文本（已入库消息接管展示）
  useEffect(() => {
    if (!streaming) setPendingText('');
  }, [streaming]);

  // 新消息/流式增量时滚到底部（jsdom 无 scrollIntoView，可选调用兜底）
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, buffer]);

  // 流式生成者（§4.3 激活策略）：父层记录的实际激活角色优先；
  // 未传时回退「刚发送文本提及检测」（手输场景），自动连播空引导时父层必传
  const streamingSpeakerName = useMemo(() => {
    if (!streaming || members.length === 0) return null;
    if (streamingSpeakerId) return members.find((m) => m.id === streamingSpeakerId)?.name ?? null;
    const lastUserText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    return pickSpeaker(members, lastSpeakerId, pendingText || lastUserText, manualPickId).name;
  }, [streaming, members, messages, lastSpeakerId, manualPickId, pendingText, streamingSpeakerId]);

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
      <MemberBar
        members={members}
        lastSpeakerId={lastSpeakerId}
        manualPickId={manualPickId}
        onPick={onPick}
        streaming={streaming}
        nextSpeakerName={nextSpeakerName}
        replyLength={replyLength}
        onReplyLengthChange={onReplyLengthChange}
        autoPlay={autoPlay}
        onAutoPlayToggle={onAutoPlayToggle}
      />

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
              onSpeak={onSpeak}
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
      <div
        className="safe-bottom border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-2 py-2 sm:px-4"
        style={{ marginBottom: keyboardInset }}
      >
        {quickDirectives.length > 0 && (
          <div className="mx-auto mb-1.5 flex max-w-3xl flex-wrap gap-1.5" data-testid="quick-directives">
            {quickDirectives.map((d, i) => {
              const implicit = isImplicitDirective(d);
              return (
                <button
                  key={`${i}-${d}`}
                  type="button"
                  disabled={streaming}
                  title={implicit ? '隐式引导：推进剧情但不留下你的发言记录' : `发送「${d}」`}
                  data-testid="quick-directive-chip"
                  onClick={() => {
                    onSend(d, { implicit });
                    if (!implicit) setPendingText(d);
                  }}
                  className="rounded-full border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2.5 py-1 text-xs text-[hsl(var(--fg-muted))] transition-colors hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--fg))] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {d}
                </button>
              );
            })}
          </div>
        )}
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
