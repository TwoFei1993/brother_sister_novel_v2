/**
 * 风格预设确认弹窗（设计共识 D3：非通用预设生效的唯一入口）——
 * 通用（常驻）/ 匹配推荐（含命中理由）/ 其余 三分组展示，弹窗内可改勾选，
 * 「确认应用」回传最终勾选列表（由 StylePresetSection 打开并 PATCH settings）。
 */
import { useState } from 'react';

import { groupPresets, matchReasons, type PresetLite } from './stylePresetMatch';

interface StylePresetConfirmDialogProps {
  presets: PresetLite[];
  /** 打开弹窗时的勾选草稿（stylePresetIds） */
  draft: string[];
  /** 书风格关键词（buildStyleKeywords 产物），匹配推荐与理由展示用 */
  keywords: string[];
  onConfirm: (picked: string[]) => void;
  onClose: () => void;
}

export default function StylePresetConfirmDialog({
  presets,
  draft,
  keywords,
  onConfirm,
  onClose,
}: StylePresetConfirmDialogProps) {
  const [picked, setPicked] = useState<string[]>(draft);
  const groups = groupPresets(presets, keywords);

  function toggle(id: string): void {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function renderGroup(key: 'general' | 'matched' | 'others', title: string, list: PresetLite[], withReason: boolean) {
    return (
      <div data-group={key} className="rounded-lg border border-[hsl(var(--border-soft))] p-2">
        <p className="mb-1 text-xs font-medium">{title}</p>
        {list.length === 0 && <p className="py-1 text-center text-xs text-[hsl(var(--fg-muted))]">无</p>}
        {list.map((p) => {
          const reasons = withReason ? matchReasons(p.name, p.tags ?? [], keywords) : [];
          return (
            <label key={p.id} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 text-xs hover:bg-[hsl(var(--bg))]">
              <input
                type="checkbox"
                data-preset-id={p.id}
                checked={picked.includes(p.id)}
                onChange={() => toggle(p.id)}
                className="h-3.5 w-3.5 accent-[hsl(var(--accent))]"
              />
              <span className="truncate">{p.name}</span>
              {reasons.length > 0 && (
                <span className="ml-auto shrink-0 rounded bg-[hsl(var(--accent))]/10 px-1 text-[10px] text-[hsl(var(--accent))]">
                  命中：{reasons.join(' / ')}
                </span>
              )}
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <div
      data-testid="preset-confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="确认风格预设"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-1 text-sm font-medium">确认风格预设</p>
        <p className="mb-3 text-xs text-[hsl(var(--fg-muted))]">
          通用预设常驻；匹配推荐按书风格关键词给出（含理由），非通用预设确认后才会随生成注入。
        </p>
        <div className="space-y-2">
          {renderGroup('general', '通用（常驻）', groups.general, false)}
          {renderGroup('matched', '匹配推荐', groups.matched, true)}
          {renderGroup('others', '其余预设', groups.others, false)}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg))]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(picked)}
            data-testid="preset-confirm-ok"
            className="h-8 rounded-lg bg-[hsl(var(--accent))] px-4 text-xs font-medium text-white"
          >
            确认应用
          </button>
        </div>
      </div>
    </div>
  );
}
