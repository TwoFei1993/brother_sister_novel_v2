/**
 * 主预设条目按书选择（用户需求 2026-11-24：「写作风格」= 预设自带的文风条目，每本书自己选）。
 * 桌面（作品设置抽屉）与移动端（资料页）共用同一份渲染——两端挂载点只负责容器样式。
 *
 * - 数据：主预设 work.presetId → detectPresetGroups 识别全部分组（文风单选 / 情感基调多选 /
 *   附加选项多选 / 其它组原样——常规设定、人称设定等，用户反馈 2026-11-27：此前整组不可见）
 * - 存储：work.settings.presetPromptOverrides（只存本书改动过的条目）；组装时由 server 应用，
 *   不改预设本身、不影响其他书
 * - 保存：独立 PATCH（先取最新 revision，乐观锁），与抽屉主保存互不干扰
 * - 「已改」徽标：本书选择与预设默认不同的条目，便于看出这本书覆盖了什么
 * - 分组区的渲染拆在 GroupSection（建书弹窗共用）；AI 预选只针对 文风/基调/附加 三类
 */
import { useEffect, useRef, useState } from 'react';

import { apiFetch } from '../../../api/client';
import { updateWork } from '../../../api/works';
import type { PresetAsset } from '@shared/preset';
import type { Work } from '@shared/work';
import {
  detectPresetGroups,
  isEffective,
  PRESET_GROUP_CATEGORY_LABELS,
  type PresetGroup,
  type PresetPromptOverrides,
} from '@shared/engine/prompt/preset-overrides';

import GroupSection from './GroupSection';

interface Props {
  work: Work;
  onSaved: (w: Work) => void;
}

export default function PresetGroupPicker({ work, onSaved }: Props) {
  const [presetName, setPresetName] = useState('');
  const [groups, setGroups] = useState<PresetGroup[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [overrides, setOverrides] = useState<PresetPromptOverrides>(work.settings.presetPromptOverrides ?? {});
  const [open, setOpen] = useState<Partial<Record<string, boolean>>>({});
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [autoPicked, setAutoPicked] = useState(false);
  const [pickErr, setPickErr] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string> | null>(null);

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

  // 自动 AI 预选（用户需求 2026-11-24：AI 先预选好，人工调整）——分组加载完成且本书从未
  // 保存过覆盖表时自动触发一次；已有覆盖表的书不重触发（尊重人工调整）
  useEffect(() => {
    if (autoPicked || groups === null || work.presetId === '') return;
    if (work.settings.presetPromptOverrides !== undefined) return;
    setAutoPicked(true);
    void aiPick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, autoPicked, work.presetId, work.settings.presetPromptOverrides]);

  function apply(next: PresetPromptOverrides): void {
    dirtyRef.current = true;
    setDirty(true);
    setOverrides(next);
  }

  /** AI 预选（用户需求：AI 先根据书籍要求预选好，人工调整）——结果进草稿不落库，用户可改再保存 */
  async function aiPick(): Promise<void> {
    if (picking) return;
    setPicking(true);
    setPickErr(null);
    setReasons(null);
    try {
      const r = await apiFetch<{ overrides: Record<string, boolean>; reasons: Record<string, string> }>(
        `/api/works/${work.id}/preset-pick`,
        { method: 'POST', body: '{}' },
      );
      dirtyRef.current = true;
      setDirty(true);
      setOverrides(r.overrides);
      setReasons(r.reasons);
      // 展开有推荐的分组，便于直接看到 AI 选了什么
      setOpen((o) => ({ ...o, style: true, tone: true }));
    } catch (e) {
      setPickErr(e instanceof Error ? e.message : 'AI 预选失败，请重试');
    } finally {
      setPicking(false);
    }
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
  const hasPickable = groups.some((g) => g.category !== 'other'); // AI 预选只针对 文风/基调/附加 三类

  return (
    <div data-testid="preset-overrides">
      <p className="mb-1 text-sm font-medium">主预设《{presetName}》的文风与选项</p>
      <p className="mb-3 text-xs text-[hsl(var(--fg-muted))]">
        只对这本书生效，不改预设本身，也不影响其他书。预设文风为主，下方内置风格为附加微调。
        全部分组（含常规设定、人称等）都可按书开关；标「默认」的为预设默认包含的条目，保持开启即可。
        {changedCount > 0 && ` 本书已改 ${changedCount} 项（标「已改」）。`}
      </p>
      {hasPickable && (
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void aiPick()}
            disabled={picking || groups === null}
            data-testid="preset-ai-pick"
            className="min-h-9 rounded-lg border border-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent))] disabled:opacity-40"
          >
            {picking ? 'AI 预选中…（约 30-60 秒）' : '✨ AI 预选（按本书信息自动挑选）'}
          </button>
          <span className="text-[11px] text-[hsl(var(--fg-muted))]">AI 按题材/基调/简介先选好，你可逐项调整后再保存</span>
        </div>
      )}
      {pickErr && (
        <p className="mb-2 text-xs text-[hsl(var(--danger))]" data-testid="preset-pick-error" role="alert">
          {pickErr}
        </p>
      )}
      {groups.length === 0 && (
        <p className="py-2 text-xs text-[hsl(var(--fg-muted))]" data-testid="preset-overrides-empty">
          当前主预设没有可按书选择的文风分组。
        </p>
      )}
      {groups.map((g, i) => {
        const key = g.category === 'other' ? `x${i}` : g.category;
        const isOpen = open[key] ?? (g.category === 'style' || g.category === 'tone');
        return (
          <GroupSection
            key={g.id}
            group={g}
            workId={work.id}
            label={g.category === 'other' ? g.name : PRESET_GROUP_CATEGORY_LABELS[g.category]}
            testKey={key}
            isOpen={isOpen}
            onToggleOpen={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
            overrides={overrides}
            reasons={reasons}
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
