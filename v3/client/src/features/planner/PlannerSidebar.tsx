/**
 * 向导左侧会话栏（豆包式）：历史会话列表 + 新建 + 删除，可展开/收缩。
 * 桌面常驻（收缩为 0 宽），窄屏唤出时以浮层覆盖（不挤压聊天区）。
 */
import { X } from 'lucide-react';
import type { PlannerSession } from './sessions';

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export default function PlannerSidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onClose,
}: {
  sessions: readonly PlannerSession[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]" data-testid="planner-sidebar">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onCreate}
          data-testid="session-new"
          className="h-9 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs hover:border-[hsl(var(--accent))]"
        >
          ＋ 新会话
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="收起会话栏"
          data-testid="sidebar-collapse"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg))]"
        >
          ⟨
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sorted.map((s) => (
          <li key={s.id} className="group relative">
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              data-testid={`session-${s.id}`}
              className={`w-full rounded-lg px-3 py-2 pr-8 text-left transition-colors ${
                s.id === activeId ? 'bg-[hsl(var(--accent))]/10' : 'hover:bg-[hsl(var(--bg))]'
              }`}
            >
              <p className={`truncate text-xs font-medium ${s.id === activeId ? 'text-[hsl(var(--accent))]' : ''}`}>
                {s.title}
              </p>
              <p className="mt-0.5 text-[10px] text-[hsl(var(--fg-muted))]">{relTime(s.updatedAt)}</p>
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`删除会话「${s.title}」？`)) onDelete(s.id);
              }}
              aria-label={`删除 ${s.title}`}
              className="absolute right-1.5 top-2 hidden h-6 w-6 items-center justify-center rounded text-xs text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--danger))]/10 group-hover:flex"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
