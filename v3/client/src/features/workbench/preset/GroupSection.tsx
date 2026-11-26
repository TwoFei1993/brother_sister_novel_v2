/**
 * 单个预设分组的选择区（从 PresetGroupPicker 拆出：纯渲染，状态由宿主管理）。
 * 桌面（作品设置抽屉）与移动端（资料页）、建书弹窗（NewWorkPresetGroups）共用。
 */
import type { PresetGroup, PresetGroupMember, PresetPromptOverrides } from '@shared/engine/prompt/preset-overrides';
import { isEffective, pickSingle, toggleMulti } from '@shared/engine/prompt/preset-overrides';

export interface GroupSectionProps {
  group: PresetGroup;
  workId: string;
  /** 分组标题（语义类别用标签，其它组用组名原样） */
  label: string;
  /** data-testid 键（语义类别用类别名；其它组用 x+序号防重名） */
  testKey: string;
  isOpen: boolean;
  onToggleOpen: () => void;
  overrides: PresetPromptOverrides;
  reasons: Record<string, string> | null;
  onChange: (next: PresetPromptOverrides) => void;
}

/** 按 subsection 把成员切成连续分区（保持预设原始顺序）；无子分区时为单个无名分区 */
export function splitSections(members: PresetGroupMember[]): Array<{ title?: string; members: PresetGroupMember[] }> {
  const sections: Array<{ title?: string; members: PresetGroupMember[] }> = [];
  for (const m of members) {
    const last = sections[sections.length - 1];
    if (last && last.title === m.subsection) last.members.push(m);
    else sections.push({ title: m.subsection, members: [m] });
  }
  return sections;
}

export default function GroupSection({ group, workId, label, testKey, isOpen, onToggleOpen, overrides, reasons, onChange }: GroupSectionProps) {
  const sections = splitSections(group.members);
  return (
    <section className="mb-2" data-testid={`preset-group-${testKey}`} data-open={isOpen ? 'true' : 'false'}>
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
        data-testid={`preset-group-toggle-${testKey}`}
        className="flex min-h-9 w-full items-center justify-between rounded px-1.5 text-left text-xs font-medium hover:bg-[hsl(var(--bg))]"
      >
        <span>
          {label}
          <span className="ml-1.5 font-normal text-[hsl(var(--fg-muted))]">
            {group.mode === 'single' ? '单选' : '可多选'} · {group.members.length} 项
          </span>
        </span>
        <span className="text-[hsl(var(--fg-muted))]">{isOpen ? '收起' : '展开'}</span>
      </button>
      {isOpen && (
        <div role={group.mode === 'single' ? 'radiogroup' : 'group'} className="max-h-80 overflow-y-auto pb-1">
          {sections.map((sec, i) => (
            <div key={sec.title ?? i}>
              {sec.title && (
                <p className="mt-1 px-1.5 text-[11px] text-[hsl(var(--fg-muted))]">{sec.title}</p>
              )}
              {sec.members.map((m) => {
                const on = isEffective(group, m, overrides);
                return (
                  <label
                    key={m.identifier}
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1.5 text-xs hover:bg-[hsl(var(--bg))]"
                  >
                    <input
                      type={group.mode === 'single' ? 'radio' : 'checkbox'}
                      name={`preset-group-${workId}-${group.id}`}
                      checked={on}
                      onChange={() =>
                        onChange(group.mode === 'single' ? pickSingle(group, m.identifier, overrides) : toggleMulti(group, m, overrides))
                      }
                      data-testid={`preset-member-${m.identifier}`}
                      className="h-4 w-4 shrink-0 accent-[hsl(var(--accent))]"
                    />
                    <span className="min-w-0 flex-1 break-words">{m.name}</span>
                    {on !== m.enabled && (
                      <span className="shrink-0 rounded bg-[hsl(var(--accent))]/10 px-1 text-[10px] text-[hsl(var(--accent))]">已改</span>
                    )}
                    {m.enabled && (
                      <span
                        className="shrink-0 rounded bg-[hsl(var(--fg-muted))]/10 px-1 text-[10px] text-[hsl(var(--fg-muted))]"
                        title="预设默认包含的条目"
                      >
                        默认
                      </span>
                    )}
                    {reasons?.[m.identifier] && (
                      <span
                        className="shrink-0 rounded bg-[hsl(var(--accent))]/10 px-1 text-[10px] text-[hsl(var(--accent))]"
                        title={`AI 推荐：${reasons[m.identifier]}`}
                        data-testid="preset-ai-reason"
                      >
                        AI 推荐
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
