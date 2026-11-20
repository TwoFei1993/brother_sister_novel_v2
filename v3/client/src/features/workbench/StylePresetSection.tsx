/**
 * 写作风格 + 按风格挂预设区（用户需求：每本书资料里调风格；风格决定调用哪些酒馆预设——
 * 「通用」tag 的预设常驻启用，其余按风格匹配推荐，勾选后**经用户确认**写入 settings）：
 *
 * - 风格 select（writingStyle 枚举中文标签）+ 自定义描述（custom 时显示）
 * - 预设清单：拉全部预设按 tags 过滤——含「通用」常显勾选；tags 与书风格关键词匹配的推荐勾选
 * - 确认应用：勾选清单 → PATCH settings { writingStyle, stylePresetIds }（乐观锁，独立保存）
 * - 主预设（work.presetId）始终生效不参与勾选；组装层把附加预设 prompts 叠加进主栈尾部
 */
import { useEffect, useMemo, useState } from 'react';

import { apiFetch } from '../../api/client';
import { updateWork } from '../../api/works';
import { WRITING_STYLE_LABELS, type WritingStyle, type Work } from '@shared/work';

interface PresetLite {
  id: string;
  name: string;
  tags?: string[];
}

/** 预设 tag ↔ 书风格关键词 匹配（双向包含，如 tag「治愈」匹配基调「温情治愈」） */
function tagMatches(tag: string, keywords: string[]): boolean {
  return keywords.some((k) => k && (tag.includes(k) || k.includes(tag)));
}

export default function StylePresetSection({ work, onSaved }: { work: Work; onSaved: (w: Work) => void }) {
  const s = work.settings;
  const [style, setStyle] = useState<WritingStyle>(s.writingStyle);
  const [customStyle, setCustomStyle] = useState(s.customWritingStyle ?? '');
  const [presets, setPresets] = useState<PresetLite[] | null>(null);
  /** 勾选的附加预设 id（stylePresetIds 草稿；「通用」tag 默认勾选） */
  const [picked, setPicked] = useState<string[]>(s.stylePresetIds ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/presets', { credentials: 'include' })
      .then((r) => r.json())
      .then((list: PresetLite[]) => {
        if (!alive || !Array.isArray(list)) return;
        // 推荐勾选：tags 含「通用」或与书基调匹配的预设（仅首次初始化草稿时）
        setPresets(list);
        setPicked((prev) => {
          if (prev.length > 0) return prev;
          const keywords = [...s.storyTones, s.subGenre, WRITING_STYLE_LABELS[s.writingStyle]].flatMap((k) =>
            (k ?? '').split(/[·\s、]/),
          );
          const auto = list
            .filter((p) => (p.tags ?? []).some((tag) => tag !== '通用' && tagMatches(tag, keywords)) || (p.tags ?? []).includes('通用'))
            .map((p) => p.id);
          return [...new Set([...(s.stylePresetIds ?? []), ...auto])];
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

  /** 书风格关键词（基调/题材拆词 + 风格标签）——推荐匹配用 */
  const styleKeywords = useMemo(
    () =>
      [s.subGenre, ...s.storyTones.flatMap((t) => t.split(/([·\s])/)), WRITING_STYLE_LABELS[s.writingStyle]]
        .flatMap((k) => (k ?? '').split(/[·\s]/))
        .filter((k) => k && k !== '—'),
    [s.subGenre, s.storyTones, s.writingStyle],
  );

  function togglePick(id: string): void {
    setDirty(true);
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function apply(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      const latest = await apiFetch<Work>(`/api/works/${work.id}`);
      const updated = await updateWork(work.id, {
        revision: latest.revision,
        settings: { ...latest.settings, stylePresetIds: picked, writingStyle: style, customWritingStyle: customStyle.trim() },
      });
      onSaved(updated);
      setDirty(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '应用失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  const pickedPresets = (presets ?? []).filter((p) => picked.includes(p.id));

  return (
    <section className="border-t border-[hsl(var(--border-soft))] pt-4" data-testid="style-preset-section">
      <p className="mb-1 text-sm font-medium">写作风格与预设</p>
      <p className="mb-3 text-xs text-[hsl(var(--fg-muted))]">
        风格决定本书调用哪些酒馆预设：tag 含「通用」的预设常驻启用；与风格匹配的预设推荐勾选。
        勾选后请点「确认应用」（主预设始终生效，附加预设叠加在其后）。
      </p>

      <div className="mb-3 flex items-center gap-3">
        <label htmlFor="work-style" className="w-24 shrink-0 text-sm">
          写作风格
        </label>
        <select
          id="work-style"
          value={style}
          onChange={(e) => {
            setStyle(e.target.value as WritingStyle);
            setDirty(true);
          }}
          data-testid="work-style-select"
          className="h-9 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-sm outline-none focus:border-[hsl(var(--accent))]"
        >
          {Object.entries(WRITING_STYLE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {style === 'custom' && (
        <input
          value={customStyle}
          onChange={(e) => {
            setCustomStyle(e.target.value);
            setDirty(true);
          }}
          placeholder="自定义风格描述（如：冷峻克制的武侠笔触）"
          aria-label="自定义风格描述"
          className="mb-3 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 py-1.5 text-sm outline-none focus:border-[hsl(var(--accent))]"
        />
      )}

      {presets === null && <p className="py-2 text-xs text-[hsl(var(--fg-muted))]">预设列表加载中…</p>}
      {presets !== null && (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-[hsl(var(--border-soft))] p-2" data-testid="preset-pick-list">
          {presets.length === 0 && <p className="py-2 text-center text-xs text-[hsl(var(--fg-muted))]">暂无预设资产（先在资产库-预设导入）</p>}
          {presets.map((p) => {
            const tags = p.tags ?? [];
            const recommended = tags.includes('通用') || tags.some((tag) => tagMatches(tag, styleKeywords));
            return (
              <label key={p.id} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 text-xs hover:bg-[hsl(var(--bg))]">
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => togglePick(p.id)} className="h-3.5 w-3.5 accent-[hsl(var(--accent))]" />
                <span className="truncate">{p.name}</span>
                {tags.length > 0 && <span className="ml-auto shrink-0 text-[10px] text-[hsl(var(--fg-muted))]">{tags.join(' / ')}</span>}
                {recommended && <span className="shrink-0 rounded bg-[hsl(var(--accent))]/10 px-1 text-[10px] text-[hsl(var(--accent))]">匹配</span>}
              </label>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void apply()}
          disabled={saving || !dirty}
          data-testid="style-apply"
          className="h-9 rounded-lg bg-[hsl(var(--accent))] px-4 text-xs font-medium text-white disabled:opacity-40"
        >
          {saving ? '应用中…' : dirty ? '确认应用（风格+预设）' : '确认应用'}
        </button>
        {dirty && <span className="text-[11px] text-amber-500">有未应用的更改</span>}
      </div>
      {err && <p className="mt-1 text-xs text-[hsl(var(--danger))]">{err}</p>}
    </section>
  );
}
