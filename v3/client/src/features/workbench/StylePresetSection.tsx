/**
 * 写作风格 + 按风格挂预设区（用户需求：每本书资料里调风格；风格决定调用哪些酒馆预设——
 * 「通用」tag 的预设常驻启用，其余按风格匹配推荐，勾选后**经用户确认**写入 settings）：
 *
 * - 风格 select（writingStyle 枚举中文标签）+ 自定义描述（custom 时显示）
 * - 预设清单：拉全部预设，tag 含「通用」或 tag/名称与书风格关键词匹配的推荐勾选
 *   （匹配逻辑在 stylePresetMatch，本组件消费）
 * - 推荐重跑：风格/基调/题材变化即时重算（用本地草稿 style，未保存也跟随），只增不删
 *   并入草稿并置 dirty；用户明确取消过的预设（dismissed，D3）不偷偷加回
 * - 确认应用：走确认弹窗（D3 非通用预设生效唯一入口，draft 仅挂载时读取须条件渲染挂载）
 *   → PATCH settings { writingStyle, stylePresetIds }（乐观锁，独立保存）
 * - 主预设（work.presetId）始终生效不参与勾选；组装层把附加预设 prompts 叠加进主栈尾部
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch } from '../../api/client';
import { updateWork } from '../../api/works';
import { WRITING_STYLE_LABELS, type WritingStyle, type Work } from '@shared/work';
import StylePresetConfirmDialog from './StylePresetConfirmDialog';
import { buildStyleKeywords, matchReasons, type PresetLite } from './stylePresetMatch';

export default function StylePresetSection({ work, onSaved }: { work: Work; onSaved: (w: Work) => void }) {
  const s = work.settings;
  const [style, setStyle] = useState<WritingStyle>(s.writingStyle);
  const [customStyle, setCustomStyle] = useState(s.customWritingStyle ?? '');
  const [presets, setPresets] = useState<PresetLite[] | null>(null);
  /** 勾选草稿（stylePresetIds；「通用」+风格匹配预设自动并入，只增不删） */
  const [picked, setPicked] = useState<string[]>(s.stylePresetIds ?? []);
  /** 本次会话新并入的推荐 id（列表打「新」徽标；确认保存后清空） */
  const [newRecs, setNewRecs] = useState<ReadonlySet<string>>(new Set());
  /** 确认弹窗开关（条件渲染挂载——弹窗 draft 仅挂载时读取一次） */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** D3：用户明确取消过的预设 id——①主列表手动取消 ②弹窗确认差集；会话内存态不持久化，推荐重跑不得弹回 */
  const dismissedRef = useRef<Set<string>>(new Set());

  /** 书风格关键词（题材/基调拆词+风格中文标签）：用本地草稿 style，改风格未保存时推荐即时跟随 */
  const keywords = useMemo(() => buildStyleKeywords(s.subGenre, s.storyTones, style), [s.subGenre, s.storyTones, style]);

  useEffect(() => {
    let alive = true;
    fetch('/api/presets', { credentials: 'include' })
      .then((r) => r.json())
      .then((list: PresetLite[]) => {
        if (!alive || !Array.isArray(list)) return;
        setPresets(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [work.id]);

  // 推荐重跑（替代旧「仅首次初始化」）：通用 ∪ 匹配推荐，只增不删并入草稿并置 dirty；
  // dismissed 的预设不偷偷加回（D3）。picked 入依赖：并入后二跑 added 为空自然收敛，无死循环
  useEffect(() => {
    if (!presets) return;
    const dismissed = dismissedRef.current;
    const auto = presets
      .filter((p) => {
        const tags = p.tags ?? [];
        return tags.includes('通用') || matchReasons(p.name, tags, keywords).length > 0;
      })
      .map((p) => p.id);
    const added = auto.filter((id) => !picked.includes(id) && !dismissed.has(id));
    if (added.length === 0) return;
    setPicked((prev) => [...new Set([...prev, ...added])]);
    setNewRecs((prev) => new Set([...prev, ...added]));
    setDirty(true);
  }, [presets, keywords, picked]);

  function togglePick(id: string): void {
    setDirty(true);
    if (picked.includes(id)) dismissedRef.current.add(id); // D3①：手动取消不再被推荐自动加回
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** 点「确认应用」→ 打开确认弹窗（不直接 PATCH；弹窗内可最终改勾选） */
  function openConfirm(): void {
    if (saving) return;
    setConfirmOpen(true);
  }

  /** 弹窗确认：草稿−最终勾选的差集进 dismissed（D3②，弹窗内取消的保存后不得弹回）→ PATCH */
  async function applyConfirmed(finalPicked: string[]): Promise<void> {
    setConfirmOpen(false);
    for (const id of picked) if (!finalPicked.includes(id)) dismissedRef.current.add(id);
    setPicked(finalPicked);
    setSaving(true);
    setErr(null);
    try {
      const latest = await apiFetch<Work>(`/api/works/${work.id}`);
      const updated = await updateWork(work.id, {
        revision: latest.revision,
        settings: { ...latest.settings, stylePresetIds: finalPicked, writingStyle: style, customWritingStyle: customStyle.trim() },
      });
      onSaved(updated);
      setDirty(false);
      setNewRecs(new Set()); // 已确认保存，「新」徽标清空
    } catch (e) {
      setErr(e instanceof Error ? e.message : '应用失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-t border-[hsl(var(--border-soft))] pt-4" data-testid="style-preset-section">
      {!(s.stylePresetIds?.length) && (
        <p
          data-testid="preset-hint"
          className="mb-2 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400"
        >
          尚未确认风格预设：勾选后点「确认应用」生效（不确认则仅主预设生效）
        </p>
      )}
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
            const reasons = matchReasons(p.name, tags, keywords);
            const recommended = tags.includes('通用') || reasons.length > 0;
            return (
              <label key={p.id} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 text-xs hover:bg-[hsl(var(--bg))]">
                <input
                  type="checkbox"
                  data-preset-id={p.id}
                  checked={picked.includes(p.id)}
                  onChange={() => togglePick(p.id)}
                  className="h-3.5 w-3.5 accent-[hsl(var(--accent))]"
                />
                <span className="truncate">{p.name}</span>
                {tags.length > 0 && <span className="ml-auto shrink-0 text-[10px] text-[hsl(var(--fg-muted))]">{tags.join(' / ')}</span>}
                {recommended && (
                  <span
                    title={reasons.join(' / ')}
                    className="shrink-0 rounded bg-[hsl(var(--accent))]/10 px-1 text-[10px] text-[hsl(var(--accent))]"
                  >
                    匹配
                  </span>
                )}
                {newRecs.has(p.id) && (
                  <span data-testid="preset-new-rec" className="shrink-0 rounded bg-[hsl(var(--accent))]/10 px-1 text-[10px] text-[hsl(var(--accent))]">
                    新
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={openConfirm}
          disabled={saving || !dirty}
          data-testid="style-apply"
          className="h-9 rounded-lg bg-[hsl(var(--accent))] px-4 text-xs font-medium text-white disabled:opacity-40"
        >
          {saving ? '应用中…' : dirty ? '确认应用（风格+预设）' : '确认应用'}
        </button>
        {dirty && <span className="text-[11px] text-amber-500">有未应用的更改</span>}
      </div>
      {err && <p className="mt-1 text-xs text-[hsl(var(--danger))]">{err}</p>}

      {confirmOpen && (
        <StylePresetConfirmDialog
          key={work.id}
          presets={presets ?? []}
          draft={picked}
          keywords={keywords}
          onConfirm={(finalPicked) => void applyConfirmed(finalPicked)}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </section>
  );
}
