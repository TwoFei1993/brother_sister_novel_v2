/**
 * 资料分区「文风与基调」（app 端缺口，用户反馈 2026-11-26：
 * 「文风、情绪等等还是没有地方让我选，预设也不能选」）。
 *
 * 根因：手机端此前 ① 没有任何入口给作品绑定主预设（BindingsPane 只管角色/世界书/势力/物品）；
 * ② 已有作品没有写作设置面板。而预设文风/情感基调/附加选项面板（PresetGroupPicker）
 * 只在绑定了主预设时才渲染——手机新建的书一律没绑主预设，整块选项因此无从谈起。
 *
 * - 写作风格（内置）+ 故事基调（多选 + 自定义）：草稿式，点「保存」落库——取最新 revision 后
 *   PATCH settings 并展开保留其余字段（重建对象会丢 presetPromptOverrides 等同层字段）
 * - 主预设：显示当前绑定，「选择 / 更换」打开 PresetPickerSheet；绑定与解除即存
 * - 绑定后渲染 PresetGroupPicker（与桌面端同一组件：预设自带的文风/情感基调/附加选项按书选）
 */
import { useEffect, useRef, useState } from 'react';

import { apiFetch } from '../../../../api/client';
import { getPreset } from '../../../../api/library';
import { updateWork } from '../../../../api/works';
import { StoryToneSchema, WRITING_STYLE_LABELS, type StoryTone, type Work, type WritingStyle } from '@shared/work';
import PresetGroupPicker from '../../../workbench/preset/PresetGroupPicker';
import PresetPickerSheet from './PresetPickerSheet';

interface Props {
  work: Work;
  /** 保存成功回调（宿主同步 workStore） */
  onSaved: (w: Work) => void;
}

/** 故事基调选项（与内置设定同源枚举） */
const TONES: readonly StoryTone[] = StoryToneSchema.options;

const fieldCls =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--accent))]';
const labelCls = 'mb-1 block text-xs text-[hsl(var(--fg-muted))]';
const chipCls = (on: boolean): string =>
  `min-h-8 rounded-full border px-3 text-xs ${
    on
      ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
      : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
  }`;

export default function StylePane({ work, onSaved }: Props) {
  const s = work.settings;
  const [style, setStyle] = useState<WritingStyle>(s.writingStyle);
  const [customStyle, setCustomStyle] = useState(s.customWritingStyle);
  const [tones, setTones] = useState<StoryTone[]>(s.storyTones);
  const [customTone, setCustomTone] = useState(s.customStoryTone);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 主预设名（null=未绑定或尚未加载） */
  const [presetName, setPresetName] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // 外部保存 → revision 变化：没有未保存草稿时同步服务端值（有草稿则保留）
  useEffect(() => {
    if (dirtyRef.current) return;
    setStyle(s.writingStyle);
    setCustomStyle(s.customWritingStyle);
    setTones(s.storyTones);
    setCustomTone(s.customStoryTone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.revision]);

  // 主预设名：绑定变化时重查
  useEffect(() => {
    if (work.presetId === '') {
      setPresetName(null);
      return undefined;
    }
    let alive = true;
    getPreset(work.presetId)
      .then((p) => {
        if (alive) setPresetName(p.name);
      })
      .catch(() => {
        if (alive) setPresetName('（名称加载失败）');
      });
    return () => {
      alive = false;
    };
  }, [work.presetId]);

  function touch(change: () => void): void {
    dirtyRef.current = true;
    setDirty(true);
    change();
  }

  async function save(): Promise<void> {
    if (saving || !dirty) return;
    setSaving(true);
    setErr(null);
    try {
      const latest = await apiFetch<Work>(`/api/works/${work.id}`);
      const updated = await updateWork(work.id, {
        revision: latest.revision,
        settings: {
          ...latest.settings,
          writingStyle: style,
          customWritingStyle: customStyle.trim(),
          storyTones: tones,
          customStoryTone: customTone.trim(),
        },
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

  /** 绑定 / 解除主预设（即选即存）；绑定后 PresetGroupPicker 随之出现并自动 AI 预选 */
  async function bindPreset(presetId: string): Promise<void> {
    setSheetOpen(false);
    if (presetId === work.presetId) return;
    setErr(null);
    try {
      const latest = await apiFetch<Work>(`/api/works/${work.id}`);
      onSaved(await updateWork(work.id, { revision: latest.revision, presetId }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '主预设绑定失败，请重试');
    }
  }

  const bound = work.presetId !== '';

  return (
    <section
      className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4"
      data-testid="style-pane"
    >
      <h2 className="m-serif text-sm font-semibold">文风与基调</h2>
      <p className="mb-3 text-xs leading-5 text-[hsl(var(--fg-muted))]">只对这本书生效，从下一章生成时起作用。</p>

      <label className="mb-3 block">
        <span className={labelCls}>写作风格</span>
        <select
          value={style}
          onChange={(e) => touch(() => setStyle(e.target.value as WritingStyle))}
          data-testid="style-writing"
          className={`${fieldCls} h-10`}
        >
          {Object.entries(WRITING_STYLE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {style === 'custom' && (
        <input
          value={customStyle}
          onChange={(e) => touch(() => setCustomStyle(e.target.value))}
          placeholder="自定义风格描述（如：冷峻克制的武侠笔触）"
          aria-label="自定义风格描述"
          data-testid="style-custom-writing"
          className={`${fieldCls} mb-3`}
        />
      )}

      <div className="mb-3">
        <span className={labelCls}>故事基调（情绪，可多选）</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="故事基调">
          {TONES.map((t) => {
            const on = tones.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => touch(() => setTones(on ? tones.filter((x) => x !== t) : [...tones, t]))}
                data-testid={`style-tone-${t}`}
                className={chipCls(on)}
              >
                {t}
              </button>
            );
          })}
        </div>
        <input
          value={customTone}
          onChange={(e) => touch(() => setCustomTone(e.target.value))}
          placeholder="自定义基调（如：轻松欢快、日常搞笑）"
          aria-label="自定义基调"
          data-testid="style-custom-tone"
          className={`${fieldCls} mt-2`}
        />
      </div>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !dirty}
        data-testid="style-save"
        className="mb-3 h-10 rounded-xl bg-[hsl(var(--accent))] px-4 text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
      >
        {saving ? '保存中…' : '保存文风与基调'}
      </button>
      {dirty && <span className="mb-3 ml-2 text-[11px] text-amber-500">有未保存的更改</span>}

      <div className="my-3 border-t border-[hsl(var(--border-soft))]" />

      <div className="mb-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 text-xs text-[hsl(var(--fg-muted))]">
          主预设：
          <span className="text-[hsl(var(--fg))]">
            {bound ? presetName ?? '…' : '未绑定'}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          data-testid="style-preset-change"
          className="min-h-8 shrink-0 rounded-lg border border-[hsl(var(--accent))] px-3 text-xs text-[hsl(var(--accent))]"
        >
          {bound ? '更换' : '选择'}
        </button>
      </div>
      {bound ? (
        <PresetGroupPicker work={work} onSaved={onSaved} />
      ) : (
        <p
          className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs leading-5 text-amber-700 dark:text-amber-400"
          data-testid="style-preset-hint"
        >
          预设自带的文风、情感基调和附加选项需要先绑定主预设——点「选择」，绑定后 AI 会先按这本书预选一版，你再逐项调整。
        </p>
      )}

      {err && (
        <p className="mt-2 text-xs text-[hsl(var(--danger))]" role="alert">
          {err}
        </p>
      )}
      {sheetOpen && (
        <PresetPickerSheet
          current={work.presetId}
          onSelect={(id) => void bindPreset(id)}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </section>
  );
}
