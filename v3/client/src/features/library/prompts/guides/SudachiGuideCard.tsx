/**
 * Sudachi 预设使用指南卡（第二轮体验改进）：提示词管理器列表顶部的分组结构说明。
 * 渲染为收起/展开两态，默认收起避免挤占管理器空间。
 */
import { useState } from 'react';

import { SUDACHI_GUIDE } from './preset-guides';

export default function SudachiGuideCard() {
  const [open, setOpen] = useState(false);

  return (
    <div
      data-testid="sudachi-guide"
      className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-xs leading-5 text-[hsl(var(--fg-muted))]"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[28px] w-full items-center gap-1 text-left text-sm font-medium text-[hsl(var(--fg))]"
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        Sudachi 预设使用指南
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1">
          {SUDACHI_GUIDE.map((g) => (
            <p key={g.title}>
              <span className="font-medium text-[hsl(var(--fg))]">{g.title}</span>
              {'：'}
              {g.desc}
            </p>
          ))}
          <p>提示：启用/停用改动后记得点右上角「保存」。</p>
        </div>
      )}
    </div>
  );
}
