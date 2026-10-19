/**
 * 成员栏（设计 §4.3 chat 激活策略的 UI 面）
 *
 * - 头像横排：首字圆形占位 + 角色名；当前发言者高亮呼吸（animate-pulse）
 * - 点击成员 = 手动指定下一位发言者（onPick(id)）；再点同成员 = 取消手动（onPick(null)）
 * - 轮换可见化（用户反馈四问①）：模式标签显示实时提示——未手动指定时
 *   「下一位：XX」（父层按 lastSpeakerId 轮换计算），手动点选后「已指定：XX」
 * - 控制行：回复长度三档（写 work.settings，父层 PATCH 持久化）+ 自动连播开关
 * - 当前发言者取 manualPickId ?? lastSpeakerId（手动待生效者优先展示）
 *   流式生成中禁点（生成期间激活角色已锁定）。
 */
import type { ChatReplyLength } from '@shared/work';

import type { ChatMember } from '../../engine/prompt/chat/activation';

/** 长度三档 UI 选项（档位 → 中文标签） */
const REPLY_LENGTH_OPTIONS: { value: ChatReplyLength; label: string; title: string }[] = [
  { value: 'short', label: '短', title: '简短回复（约150-300字）' },
  { value: 'medium', label: '中', title: '标准回复（约400-900字）' },
  { value: 'long', label: '长', title: '长篇回复（约800-1500字）' },
];

export interface MemberBarProps {
  members: ChatMember[];
  lastSpeakerId: string | null;
  manualPickId: string | null;
  onPick: (id: string | null) => void;
  streaming?: boolean;
  /** 轮换提示文案的发言者名（父层按 pickSpeaker 实时计算） */
  nextSpeakerName?: string;
  /** 回复长度档位（缺省视为 medium） */
  replyLength?: ChatReplyLength;
  onReplyLengthChange?: (len: ChatReplyLength) => void;
  /** 自动连播开关（作品内记忆，localStorage） */
  autoPlay?: boolean;
  onAutoPlayToggle?: () => void;
}

/** 头像占位：取名字首字（空名兜底「?」） */
export function avatarChar(name: string): string {
  return name.trim().charAt(0) || '?';
}

/** 长度控制行（testid 供测试定位；onReplyLengthChange 缺省时隐藏） */
function ReplyLengthControl({
  value,
  onChange,
  disabled,
}: {
  value: ChatReplyLength;
  onChange: (len: ChatReplyLength) => void;
  disabled: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1" data-testid="reply-length-control">
      <span className="text-xs text-[hsl(var(--fg-muted))]">长度</span>
      {REPLY_LENGTH_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            title={opt.title}
            aria-label={`回复长度：${opt.title}`}
            data-testid={`reply-length-${opt.value}`}
            data-active={active ? 'true' : 'false'}
            onClick={() => onChange(opt.value)}
            className={`h-6 min-w-7 rounded-md border px-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 font-medium text-[hsl(var(--accent))]'
                : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </span>
  );
}

export default function MemberBar({
  members,
  lastSpeakerId,
  manualPickId,
  onPick,
  streaming = false,
  nextSpeakerName,
  replyLength = 'medium',
  onReplyLengthChange,
  autoPlay = false,
  onAutoPlayToggle,
}: MemberBarProps) {
  if (members.length === 0) return null;
  const activeId = manualPickId ?? lastSpeakerId;

  return (
    <div className="border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2" data-testid="member-bar">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <span
          data-testid="member-mode-tag"
          title={manualPickId == null ? '按发言顺序自动轮换' : '已手动指定下一位发言者，发送后自动复位'}
          className="shrink-0 rounded-full border border-[hsl(var(--border-soft))] px-2 py-0.5 text-xs text-[hsl(var(--fg-muted))]"
        >
          {manualPickId == null ? `下一位：${nextSpeakerName ?? '…'}` : `已指定：${nextSpeakerName ?? '…'}`}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5">
          {members.map((m) => {
            const active = m.id === activeId;
            return (
              <button
                key={m.id}
                type="button"
                disabled={streaming}
                onClick={() => onPick(m.id === manualPickId ? null : m.id)}
                data-testid="member-item"
                data-id={m.id}
                data-picked={active ? 'true' : 'false'}
                title={active ? '当前发言者' : `指定 ${m.name} 为下一位发言者`}
                className={`flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? 'animate-pulse bg-[hsl(var(--accent))]/10 ring-2 ring-[hsl(var(--accent))]'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                <span
                  className={`flex size-9 items-center justify-center rounded-full text-sm font-semibold ${
                    active
                      ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]'
                      : 'bg-[hsl(var(--bg))] text-[hsl(var(--fg-muted))]'
                  }`}
                  data-testid="member-avatar"
                >
                  {avatarChar(m.name)}
                </span>
                <span className="max-w-14 truncate text-xs text-[hsl(var(--fg-muted))]">{m.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      {(onReplyLengthChange || onAutoPlayToggle) && (
        <div className="mx-auto mt-1.5 flex max-w-3xl flex-wrap items-center gap-2">
          {onReplyLengthChange && (
            <ReplyLengthControl value={replyLength} onChange={onReplyLengthChange} disabled={streaming} />
          )}
          {onAutoPlayToggle && (
            <button
              type="button"
              disabled={streaming}
              aria-pressed={autoPlay}
              data-testid="auto-play-toggle"
              onClick={onAutoPlayToggle}
              className={`flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                autoPlay
                  ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 font-medium text-[hsl(var(--accent))]'
                  : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]'
              }`}
            >
              <span aria-hidden>{autoPlay ? '⏸' : '▶'}</span>
              自动{autoPlay ? '（连播中）' : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
