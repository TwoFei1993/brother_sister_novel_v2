/**
 * 提示词管理器单行（收起态 + 展开编辑态）
 *
 * 行结构：启停 checkbox → 名称（marker 加「系统位」徽标）→ 角色 → token 预览
 * → 上/下移 → 展开编辑。编辑态：name/role/content + 自定义项深度注入参数
 * （injection_depth/injection_order），删除仅对自定义项开放。
 */
import type { TavernPrompt } from '@shared/tavern';

export interface PromptRowProps {
  /** 名称（prompt.name 缺省回退 identifier） */
  name: string;
  identifier: string;
  enabled: boolean;
  /** 系统位 marker（chatHistory/main/jailbreak/worldInfoBefore 等） */
  marker: boolean;
  role: string;
  /** 行级 token 预览；null = 无可计内容 */
  tokens: number | null;
  expanded: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** 关联的 prompt 定义（编辑态取 content/injection 字段；order 里未登记时缺省） */
  prompt?: TavernPrompt;
  /** 编辑回调：局部补丁合入该 prompt */
  onChange: (patch: Partial<TavernPrompt>) => void;
  onToggleEnabled: () => void;
  onMove: (dir: -1 | 1) => void;
  onToggleExpand: () => void;
  onDelete: () => void;
}

const ROLES = ['system', 'user', 'assistant'] as const;

export default function PromptRow(props: PromptRowProps) {
  const {
    name, identifier, enabled, marker, role, tokens, expanded,
    isFirst, isLast, onChange, onToggleEnabled, onMove, onToggleExpand, onDelete,
  } = props;

  return (
    <li
      data-prompt-row={identifier}
      className={`rounded-xl border bg-[hsl(var(--surface))] transition-colors ${
        enabled ? 'border-[hsl(var(--border-soft))]' : 'border-dashed border-[hsl(var(--border-soft))] opacity-60'
      }`}
    >
      {/* 收起态行头 */}
      <div className="flex items-center gap-2 px-3 py-2">
        <label className="flex min-h-[36px] cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            aria-label={`启用 ${name}`}
            checked={enabled}
            onChange={onToggleEnabled}
            className="h-4 w-4 accent-[hsl(var(--accent))]"
          />
        </label>
        <button
          type="button"
          onClick={onToggleExpand}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          <span className="block truncate text-sm font-medium text-[hsl(var(--fg))]">
            {name}
            {marker && (
              <span className="ml-2 rounded bg-[hsl(var(--accent))]/15 px-1.5 py-0.5 align-middle text-[10px] text-[hsl(var(--accent))]">
                系统位
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-[hsl(var(--fg-muted))]">
            {role} · {tokens === null ? '—' : `~${tokens}`}
          </span>
        </button>
        <button
          type="button"
          aria-label={`上移 ${name}`}
          disabled={isFirst}
          onClick={() => onMove(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-[hsl(var(--fg-muted))] hover:border-[hsl(var(--border-soft))] disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`下移 ${name}`}
          disabled={isLast}
          onClick={() => onMove(1)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-[hsl(var(--fg-muted))] hover:border-[hsl(var(--border-soft))] disabled:opacity-30"
        >
          ↓
        </button>
      </div>

      {/* 展开编辑态 */}
      {expanded && (
        <div className="flex flex-col gap-3 border-t border-[hsl(var(--border-soft))] px-3 py-3">
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-[hsl(var(--fg-muted))]">
              名称
              <input
                value={name}
                onChange={(e) => onChange({ name: e.target.value })}
                className="mt-1 min-h-[36px] w-full rounded-lg border border-[hsl(var(--border-soft))] bg-transparent px-2 text-sm text-[hsl(var(--fg))]"
              />
            </label>
            <label className="w-28 text-xs text-[hsl(var(--fg-muted))]">
              角色
              <select
                value={ROLES.includes(role as (typeof ROLES)[number]) ? role : 'system'}
                onChange={(e) => onChange({ role: e.target.value })}
                className="mt-1 min-h-[36px] w-full rounded-lg border border-[hsl(var(--border-soft))] bg-transparent px-2 text-sm text-[hsl(var(--fg))]"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="text-xs text-[hsl(var(--fg-muted))]">
            内容
            <textarea
              value={props.prompt?.content ?? ''}
              onChange={(e) => onChange({ content: e.target.value })}
              rows={5}
              className="mt-1 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-transparent px-2 py-1.5 text-sm text-[hsl(var(--fg))]"
            />
          </label>
          {!marker && (
            <div className="flex gap-2">
              <label className="w-36 text-xs text-[hsl(var(--fg-muted))]">
                注入深度
                <input
                  type="number"
                  min={0}
                  value={props.prompt?.injection_depth ?? 0}
                  onChange={(e) => onChange({ injection_depth: Number(e.target.value) })}
                  className="mt-1 min-h-[36px] w-full rounded-lg border border-[hsl(var(--border-soft))] bg-transparent px-2 text-sm text-[hsl(var(--fg))]"
                />
              </label>
              <label className="w-36 text-xs text-[hsl(var(--fg-muted))]">
                注入顺序
                <input
                  type="number"
                  value={props.prompt?.injection_order ?? 100}
                  onChange={(e) => onChange({ injection_order: Number(e.target.value) })}
                  className="mt-1 min-h-[36px] w-full rounded-lg border border-[hsl(var(--border-soft))] bg-transparent px-2 text-sm text-[hsl(var(--fg))]"
                />
              </label>
              <button
                type="button"
                onClick={onDelete}
                className="ml-auto mt-auto min-h-[36px] rounded-lg border border-red-400/40 px-3 text-sm text-red-400 hover:bg-red-400/10"
              >
                删除
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
