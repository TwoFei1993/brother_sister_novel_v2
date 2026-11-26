/**
 * 建书时的预设文风 / 情感基调选择（用户反馈 2026-11-26：创建时就要能选风格与基调，
 * 且要真实挂上预设——勾选结果随 createWork 写进 settings.presetPromptOverrides，组装时按书生效：
 * 文风条目提权进要求块（resolvePresetStyle），其余条目按覆盖表启停（applyPresetOverrides））。
 *
 * 只暴露 文风（单选）与 情感基调（多选）两组；附加选项条目多，创建后到 资料→文风与基调 里调
 * （那里的完整版 PresetGroupPicker 与本组件同一套生效判定纯函数）。
 */
import { useEffect, useState } from 'react';

import { apiFetch } from '../../../api/client';
import type { PresetAsset } from '@shared/preset';
import {
  PRESET_GROUP_CATEGORY_LABELS,
  detectPresetGroups,
  isEffective,
  pickSingle,
  toggleMulti,
  type PresetGroup,
  type PresetGroupMember,
  type PresetPromptOverrides,
} from '@shared/engine/prompt/preset-overrides';

interface Props {
  presetId: string;
  /** 勾选状态（本书的覆盖表；只收改动过的条目） */
  overrides: PresetPromptOverrides;
  onChange: (next: PresetPromptOverrides) => void;
}

const chipCls = (on: boolean): string =>
  `min-h-8 rounded-full border px-3 text-xs transition-colors ${
    on
      ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
      : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
  }`;

export default function NewWorkPresetGroups({ presetId, overrides, onChange }: Props) {
  const [name, setName] = useState('');
  const [groups, setGroups] = useState<PresetGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (presetId === '') return undefined;
    let alive = true;
    setGroups(null);
    setFailed(false);
    apiFetch<PresetAsset>(`/api/presets/${presetId}`)
      .then((a) => {
        if (!alive) return;
        setName(a.name);
        setGroups(detectPresetGroups(a.raw));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [presetId, tick]);

  if (presetId === '') return null;
  if (failed) {
    return (
      <p className="mb-3 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400" data-testid="new-work-preset-groups-error">
        预设选项加载失败——可先创建，之后在 资料→文风与基调 里选择。
        <button type="button" onClick={() => setTick((n) => n + 1)} className="ml-2 underline">
          重试
        </button>
      </p>
    );
  }
  if (groups === null) {
    return <p className="mb-3 text-xs text-[hsl(var(--fg-muted))]" data-testid="new-work-preset-groups-loading">预设选项加载中…</p>;
  }
  const style = groups.find((g) => g.category === 'style');
  const tone = groups.find((g) => g.category === 'tone');
  if (!style && !tone) return null; // 该预设没有可按书选的分组

  return (
    <div className="mb-3 rounded-lg border border-[hsl(var(--border-soft))] p-3" data-testid="new-work-preset-groups">
      <p className="mb-2 text-xs font-medium">
        《{name}》的文风与基调
        <span className="ml-1 font-normal text-[hsl(var(--fg-muted))]">——随本书生效，创建后可在 资料→文风与基调 继续调（含附加选项）</span>
      </p>
      {style && <GroupChips group={style} overrides={overrides} onChange={onChange} testPrefix="new-work-preset-style" />}
      {tone && <GroupChips group={tone} overrides={overrides} onChange={onChange} testPrefix="new-work-preset-tone" />}
    </div>
  );
}

interface GroupChipsProps {
  group: PresetGroup;
  overrides: PresetPromptOverrides;
  onChange: (next: PresetPromptOverrides) => void;
  testPrefix: string;
}

/** 按 subsection 切连续分区（保持预设原始顺序；Sudachi 文风分 新文/老文） */
function GroupChips({ group, overrides, onChange, testPrefix }: GroupChipsProps) {
  const sections: Array<{ title?: string; members: PresetGroupMember[] }> = [];
  for (const m of group.members) {
    const last = sections[sections.length - 1];
    if (last && last.title === m.subsection) last.members.push(m);
    else sections.push({ title: m.subsection, members: [m] });
  }
  return (
    <div className="mb-2 last:mb-0" data-testid={`${testPrefix}-group`}>
      <span className="mb-1.5 block text-xs text-[hsl(var(--fg-muted))]">
        {PRESET_GROUP_CATEGORY_LABELS[group.category]}（{group.mode === 'single' ? '单选' : '可多选'}）
      </span>
      {sections.map((sec, i) => (
        <div key={sec.title ?? i}>
          {sec.title && <p className="mb-1 text-[11px] text-[hsl(var(--fg-muted))]">{sec.title}</p>}
          <div className="flex flex-wrap gap-1.5">
            {sec.members.map((m) => {
              const on = isEffective(group, m, overrides);
              return (
                <button
                  key={m.identifier}
                  type="button"
                  aria-pressed={on}
                  data-testid={`${testPrefix}-${m.identifier}`}
                  title={on !== m.enabled ? '本书已改（预设默认为' + (m.enabled ? '开' : '关') + '）' : undefined}
                  onClick={() =>
                    onChange(group.mode === 'single' ? pickSingle(group, m.identifier, overrides) : toggleMulti(group, m, overrides))
                  }
                  className={chipCls(on)}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
