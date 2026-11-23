/**
 * 主预设条目按书选择（用户需求 2026-11-24：「写作风格」= 预设自带的文风条目，每本书自己选）。
 * 桌面（作品设置抽屉）与移动端（资料页）共用同一份渲染——两端挂载点只负责容器样式。
 *
 * - 数据：主预设 work.presetId → detectPresetGroups 识别 文风(单选)/情感基调(多选)/附加选项(多选)
 * - 存储：work.settings.presetPromptOverrides（只存本书改动过的条目）；组装时由 server 应用，
 *   不改预设本身、不影响其他书
 * - 保存：独立 PATCH（先取最新 revision，乐观锁），与抽屉主保存互不干扰
 * - 「已改」徽标：本书选择与预设默认不同的条目，便于看出这本书覆盖了什么
 */
import { useEffect, useRef, useState } from 'react';

import { apiFetch } from '../../../api/client';
import { updateWork } from '../../../api/works';
import type { PresetAsset } from '@shared/preset';
import type { Work } from '@shared/work';
import {
  PRESET_GROUP_CATEGORY_LABELS,
  detectPresetGroups,
  isEffective,
  pickSingle,
  toggleMulti,
  type PresetGroup,
  type PresetGroupCategory,
  type PresetGroupMember,
  type PresetPromptOverrides,
} from '@shared/engine/prompt/preset-overrides';

interface Props {
  work: Work;
  onSaved: (w: Work) => void;
}

const CATEGORY_ORDER: readonly PresetGroupCategory[] = ['style', 'tone', 'addon'];
/** 默认展开：附加选项条目多（Sudachi 32 条），默认折叠 */
const DEFAULT_OPEN: Record<PresetGroupCategory, boolean> = { style: true, tone: true, addon: false };

export default function PresetGroupPicker({ work, onSaved }: Props) {
  const [presetName, setPresetName] = useState('');
  const [groups, setGroups] = useState<PresetGroup[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [overrides, setOverrides] = useState<PresetPromptOverrides>(work.settings.presetPromptOverrides ?? {});
  const [open, setOpen] = useState<Partial<Record<PresetGroupCategory, boolean>>>({});
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (work.presetId === '') return undefined;
    let alive = true;
    setGroups(null);
    setLoadErr(null);
    apiFetch<PresetAsset>(`/api/presets/${work.presetId}`)
      .then((a) => {
        if (!alive) return;
        setPresetName(a.name);
        setGroups(detectPresetGroups(a.raw));
      })
      .catch((e: unknown) => {
        if (alive) setLoadErr(e instanceof Error ? e.message : '主预设加载失败');
      });
    return () => {
      alive = false;
    };
  }, [work.presetId, reloadTick]);

  // 外部保存/切书 → revision 变化：草稿未修改时同步服务端值（已修改则保留草稿）
  useEffect(() => {
    if (dirtyRef.current) return;
    setOverrides(work.settings.presetPromptOverrides ?? {});
  }, [work.revision]);

  function apply(next: PresetPromptOverrides): void {
    dirtyRef.current = true;
    setDirty(true);
    setOverrides(next);
  }

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      const latest = await apiFetch<Work>(`/api/works/${work.id}`);
      const updated = await updateWork(work.id, {
        revision: latest.revision,
        settings: { ...latest.settings, presetPromptOverrides: overrides },
      });
      dirtyRef.current = false;
      setDirty(false);
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  if (work.presetId === '') return null; // 未绑定主预设：无可选项（hooks 之后再早退）
  if (loadErr) {
    return (
      <div className="text-xs" data-testid="preset-overrides-error">
        <p className="text-[hsl(var(--danger))]">主预设加载失败：{loadErr}</p>
        <button
          type="button"
          onClick={() => setReloadTick((n) => n + 1)}
          className="mt-2 min-h-9 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs text-[hsl(var(--accent))]"
        >
          重试
        </button>
      </div>
    );
  }
  if (groups === null) return <p className="py-2 text-xs text-[hsl(var(--fg-muted))]">预设选项加载中…</p>;

  const changedCount = groups.reduce(
    (n, g) => n + g.members.filter((m) => isEffective(g, m, overrides) !== m.enabled).length,
    0,
  );

  return (
    <div data-testid="preset-overrides">
      <p className="mb-1 text-sm font-medium">主预设《{presetName}》的文风与选项</p>
      <p className="mb-3 text-xs text-[hsl(var(--fg-muted))]">
        只对这本书生效，不改预设本身，也不影响其他书。预设文风为主，下方内置风格为附加微调。
        {changedCount > 0 && ` 本书已改 ${changedCount} 项（标「已改」）。`}
      </p>
      {groups.length === 0 && (
        <p className="py-2 text-xs text-[hsl(var(--fg-muted))]" data-testid="preset-overrides-empty">
          当前主预设没有可按书选择的文风分组。
        </p>
      )}
      {CATEGORY_ORDER.map((category) => {
        const group = groups.find((g) => g.category === category);
        if (!group) return null;
        return (
          <GroupSection
            key={group.id}
            group={group}
            workId={work.id}
            isOpen={open[category] ?? DEFAULT_OPEN[category]}
            onToggleOpen={() => setOpen((o) => ({ ...o, [category]: !(o[category] ?? DEFAULT_OPEN[category]) }))}
            overrides={overrides}
            onChange={apply}
          />
        );
      })}
      {groups.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty}
            data-testid="preset-overrides-save"
            className="min-h-9 rounded-lg bg-[hsl(var(--accent))] px-4 text-xs font-medium text-white disabled:opacity-40"
          >
            {saving ? '保存中…' : '保存预设选项'}
          </button>
          {dirty && <span className="text-[11px] text-amber-500">有未保存的更改</span>}
        </div>
      )}
      {err && <p className="mt-1 text-xs text-[hsl(var(--danger))]">{err}</p>}
    </div>
  );
}

interface GroupSectionProps {
  group: PresetGroup;
  workId: string;
  isOpen: boolean;
  onToggleOpen: () => void;
  overrides: PresetPromptOverrides;
  onChange: (next: PresetPromptOverrides) => void;
}

/** 按 subsection 把成员切成连续分区（保持预设原始顺序）；无子分区时为单个无名分区 */
function splitSections(members: PresetGroupMember[]): Array<{ title?: string; members: PresetGroupMember[] }> {
  const sections: Array<{ title?: string; members: PresetGroupMember[] }> = [];
  for (const m of members) {
    const last = sections[sections.length - 1];
    if (last && last.title === m.subsection) last.members.push(m);
    else sections.push({ title: m.subsection, members: [m] });
  }
  return sections;
}

function GroupSection({ group, workId, isOpen, onToggleOpen, overrides, onChange }: GroupSectionProps) {
  const sections = splitSections(group.members);
  return (
    <section className="mb-2" data-testid={`preset-group-${group.category}`} data-open={isOpen ? 'true' : 'false'}>
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
        data-testid={`preset-group-toggle-${group.category}`}
        className="flex min-h-9 w-full items-center justify-between rounded px-1.5 text-left text-xs font-medium hover:bg-[hsl(var(--bg))]"
      >
        <span>
          {PRESET_GROUP_CATEGORY_LABELS[group.category]}
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
