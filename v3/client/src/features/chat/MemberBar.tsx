/**
 * 成员栏（设计 §4.3 chat 激活策略的 UI 面）
 *
 * - 头像横排：首字圆形占位 + 角色名；当前发言者高亮呼吸（animate-pulse）
 * - 点击成员 = 手动指定下一位发言者（onPick(id)）；再点同成员 = 取消手动（onPick(null)）
 * - 标签态：未手动指定时显示「自动轮换」，手动指定时显示「手动指定」
 * - 当前发言者取 manualPickId ?? lastSpeakerId（手动待生效者优先展示）
 *   流式生成中禁点（生成期间激活角色已锁定）。
 */
import type { ChatMember } from '../../engine/prompt/activation';

export interface MemberBarProps {
  members: ChatMember[];
  lastSpeakerId: string | null;
  manualPickId: string | null;
  onPick: (id: string | null) => void;
  streaming?: boolean;
}

/** 头像占位：取名字首字（空名兜底「?」） */
export function avatarChar(name: string): string {
  return name.trim().charAt(0) || '?';
}

export default function MemberBar({ members, lastSpeakerId, manualPickId, onPick, streaming = false }: MemberBarProps) {
  if (members.length === 0) return null;
  const activeId = manualPickId ?? lastSpeakerId;

  return (
    <div className="border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2" data-testid="member-bar">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <span
          data-testid="member-mode-tag"
          className="shrink-0 rounded-full border border-[hsl(var(--border-soft))] px-2 py-0.5 text-xs text-[hsl(var(--fg-muted))]"
        >
          {manualPickId == null ? '自动轮换' : '手动指定'}
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
    </div>
  );
}
