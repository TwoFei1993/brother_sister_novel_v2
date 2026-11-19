/**
 * 分卷规划编辑列表（作品设置抽屉子组件，自 WorkOutlineSection 拆出——保持母文件 ≤300 行）
 *
 * 卷规划层展示与编辑：每卷 = 卷号 + 卷名 + 起始章 + 本卷概述（textarea）+ 删除按钮；
 * 添加卷由父级传入 onAdd（追加「现有最大卷号+1」的空卷）。纯受控组件，保存逻辑在父级。
 */
import { Trash2 } from 'lucide-react';

import type { VolumeOutlineItem } from '@shared/work';

interface VolumeOutlineListProps {
  volumes: VolumeOutlineItem[];
  onUpdate: (i: number, patch: Partial<VolumeOutlineItem>) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
}

/** 卷号输入兜底：非法值回退原值，最小 1（防存出 0/负数卷号） */
function clampIndex(value: string, fallback: number): number {
  return Math.max(1, Math.floor(Number(value) || fallback));
}

const fieldCls =
  'rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] text-sm outline-none focus:border-[hsl(var(--accent))]';

export default function VolumeOutlineList({ volumes, onUpdate, onRemove, onAdd }: VolumeOutlineListProps) {
  return (
    <>
      {volumes.length > 0 && (
        <div
          data-testid="volume-list"
          className="mb-2 max-h-60 space-y-2 overflow-y-auto rounded-lg border border-[hsl(var(--border-soft))] p-2"
        >
          {volumes.map((v, i) => (
            <div key={i} className="rounded-lg bg-[hsl(var(--bg))] p-2" data-testid={`volume-row-${i}`}>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={v.index}
                  onChange={(e) => onUpdate(i, { index: clampIndex(e.target.value, v.index) })}
                  aria-label={`第 ${i + 1} 项卷号`}
                  data-testid={`volume-index-${i}`}
                  className={`h-8 w-14 shrink-0 px-2 ${fieldCls}`}
                />
                <input
                  value={v.title}
                  onChange={(e) => onUpdate(i, { title: e.target.value })}
                  placeholder="卷名"
                  aria-label="卷名"
                  data-testid={`volume-title-${i}`}
                  className={`h-8 min-w-0 flex-1 px-2 ${fieldCls}`}
                />
                <label className="flex shrink-0 items-center gap-1 text-xs text-[hsl(var(--fg-muted))]">
                  起始章
                  <input
                    type="number"
                    min={1}
                    value={v.startChapter ?? ''}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      onUpdate(i, { startChapter: Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined });
                    }}
                    aria-label="本卷起始章号"
                    data-testid={`volume-start-${i}`}
                    className={`h-8 w-14 px-2 ${fieldCls}`}
                  />
                </label>
                <label className="flex shrink-0 items-center gap-1 text-xs text-[hsl(var(--fg-muted))]">
                  章数
                  <input
                    type="number"
                    min={1}
                    value={v.chapterCount ?? ''}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      onUpdate(i, { chapterCount: Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined });
                    }}
                    aria-label="本卷章数"
                    data-testid={`volume-count-${i}`}
                    title="本卷包含几章（用户选择）；下一卷起始章自动顺延"
                    className={`h-8 w-14 px-2 ${fieldCls}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label={`删除第 ${v.index} 卷规划`}
                  data-testid={`volume-remove-${i}`}
                  title="删除本卷规划"
                  className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg border border-red-400/40 px-1 text-sm text-red-400 hover:bg-red-400/10"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <textarea
                value={v.summary}
                onChange={(e) => onUpdate(i, { summary: e.target.value })}
                rows={2}
                placeholder="本卷主线概述：本卷起止事件与主线推进（150-300 字）"
                aria-label="本卷主线概述"
                data-testid={`volume-summary-${i}`}
                className={`mt-1 w-full resize-y p-2 leading-5 ${fieldCls}`}
              />
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onAdd}
        data-testid="volume-add"
        className="min-h-[36px] rounded-lg border border-[hsl(var(--border-soft))] px-3 text-sm text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]"
      >
        ＋ 添加卷
      </button>
    </>
  );
}
