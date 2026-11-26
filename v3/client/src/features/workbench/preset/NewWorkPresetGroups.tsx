/**
 * 建书时的预设文风 / 情感基调选择（用户反馈 2026-11-26：创建时就要能选风格与基调，
 * 且要真实挂上预设——勾选结果随 createWork 写进 settings.presetPromptOverrides，组装时按书生效：
 * 文风条目提权进要求块（resolvePresetStyle），其余条目按覆盖表启停（applyPresetOverrides））。
 *
 * 文风（单选）与情感基调（多选）默认展开；其余组（附加选项 / 常规设定 / 人称…）收在
 * 「更多分组」里按需展开——预设里有什么组就显示什么组（用户反馈 2026-11-27：此前整组不可见）。
 * 与资料页完整版（PresetGroupPicker）同一套生效判定纯函数。
 *
 * 绑定预设后自动 AI 预选（用户反馈 2026-11-27：选了什么文风基调，就默认勾选对应的条目，其余照常显示可调）：
 * 书籍信息内联走 /works/preset-pick-preview（与资料页的自动预选同一套挑选逻辑，一次调用）；失败时
 * 静默回落到预设默认勾选态。
 */
import { useEffect, useRef, useState } from 'react';

import { apiFetch } from '../../../api/client';
import { presetPickPreview } from '../../../api/works';
import type { PresetAsset } from '@shared/preset';
import type { PresetGroup, PresetGroupMember, PresetPromptOverrides } from '@shared/engine/prompt/preset-overrides';
import { detectPresetGroups, isEffective, pickSingle, toggleMulti } from '@shared/engine/prompt/preset-overrides';

/** 建书弹窗当前选择的书籍信息（AI 预选的依据；字段与 preset-pick-preview 请求体对应） */
export interface NewWorkBookInfo {
  title?: string;
  genre?: string;
  storyTones?: string[];
  customStoryTone?: string;
  writingStyle?: string;
  fandomSource?: string;
  fandomType?: string;
  fandomNotes?: string;
}

interface Props {
  presetId: string;
  /** 勾选状态（本书的覆盖表；只收改动过的条目） */
  overrides: PresetPromptOverrides;
  onChange: (next: PresetPromptOverrides) => void;
  /** 当前建书选择（AI 预选的依据）；不传则不自动预选 */
  bookInfo?: NewWorkBookInfo;
}

const chipCls = (on: boolean): string =>
  `min-h-8 rounded-full border px-3 text-xs transition-colors ${
    on
      ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
      : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
  }`;

export default function NewWorkPresetGroups({ presetId, overrides, onChange, bookInfo }: Props) {
  const [name, setName] = useState('');
  const [groups, setGroups] = useState<PresetGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [aiState, setAiState] = useState<'idle' | 'picking' | 'done' | 'failed'>('idle');
  /** 每个预设只自动预选一次；预选期间用户手动勾的以手动为准 */
  const firedFor = useRef('');
  const lastUser = useRef<Record<string, boolean> | null>(null);
  const bookInfoRef = useRef(bookInfo);
  bookInfoRef.current = bookInfo;

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

  // 绑定预设后按当前选择自动 AI 预选一次（每个预设只发一次；失败回落到预设默认，不打扰）。
  // 必须在所有提前 return 之前：hooks 顺序不能随分支变化
  useEffect(() => {
    if (groups === null || presetId === '' || !bookInfoRef.current) return;
    if (firedFor.current === presetId) return;
    if (!groups.some((g) => g.category !== 'other')) return; // 没有可预选的语义分组
    firedFor.current = presetId;
    setAiState('picking');
    presetPickPreview({ presetId, ...bookInfoRef.current })
      .then((r) => {
        onChange({ ...r.overrides, ...(lastUser.current ?? {}) }); // 预选期间手动勾的以手动为准
        setAiState('done');
      })
      .catch(() => setAiState('failed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 每个预设只发一次；onChange 为父级稳定引用
  }, [groups, presetId]);

  /** 芯片的手动勾选：记录最后一次手动结果（预选迟到时以手动为准） */
  const handleChipChange = (next: PresetPromptOverrides): void => {
    lastUser.current = next;
    onChange(next);
  };

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
  const extras = groups.filter((g) => g.category !== 'style' && g.category !== 'tone');
  if (!style && !tone && extras.length === 0) return null; // 该预设没有可按书选的分组

  return (
    <div className="mb-3 rounded-lg border border-[hsl(var(--border-soft))] p-3" data-testid="new-work-preset-groups">
      <p className="mb-2 text-xs font-medium">
        《{name}》的文风与基调
        <span className="ml-1 font-normal text-[hsl(var(--fg-muted))]">——随本书生效，创建后可在 资料→文风与基调 继续调</span>
      </p>
      {aiState === 'picking' && (
        <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]" data-testid="new-work-preset-ai">
          AI 正按你选的文风与基调预选条目…（约 30-60 秒，其余条目照常显示）
        </p>
      )}
      {aiState === 'done' && (
        <p className="mb-2 text-xs text-[hsl(var(--accent))]" data-testid="new-work-preset-ai-done">
          已按你选的文风与基调预选——其余条目也都在，可逐项调整
        </p>
      )}
      {aiState === 'failed' && (
        <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]" data-testid="new-work-preset-ai-failed">
          AI 预选没成功——先按预设默认勾选；可手动调，或创建后在 资料→文风与基调 重试
        </p>
      )}
      {style && (
        <GroupChips group={style} label="文风（单选）" overrides={overrides} onChange={handleChipChange} testPrefix="new-work-preset-style" />
      )}
      {tone && (
        <GroupChips group={tone} label="情感基调（可多选）" overrides={overrides} onChange={handleChipChange} testPrefix="new-work-preset-tone" />
      )}
      {extras.length > 0 && (
        <details className="mt-1" data-testid="new-work-preset-extras">
          <summary className="cursor-pointer text-xs text-[hsl(var(--fg-muted))]">
            更多分组（附加选项 / 常规设定 / 人称 等 {extras.length} 组——展开可按书开关）
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {extras.map((g, i) => (
              <GroupChips
                key={g.id}
                group={g}
                label={g.category === 'addon' ? `附加选项（可多选）` : `${g.name}（可多选）`}
                overrides={overrides}
                onChange={handleChipChange}
                testPrefix={`new-work-preset-x${i}`}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

interface GroupChipsProps {
  group: PresetGroup;
  label: string;
  overrides: PresetPromptOverrides;
  onChange: (next: PresetPromptOverrides) => void;
  testPrefix: string;
}

/** 按 subsection 切连续分区（保持预设原始顺序；Sudachi 文风分 新文/老文） */
function GroupChips({ group, label, overrides, onChange, testPrefix }: GroupChipsProps) {
  const sections: Array<{ title?: string; members: PresetGroupMember[] }> = [];
  for (const m of group.members) {
    const last = sections[sections.length - 1];
    if (last && last.title === m.subsection) last.members.push(m);
    else sections.push({ title: m.subsection, members: [m] });
  }
  return (
    <div className="mb-2 last:mb-0" data-testid={`${testPrefix}-group`}>
      <span className="mb-1.5 block text-xs text-[hsl(var(--fg-muted))]">{label}</span>
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
