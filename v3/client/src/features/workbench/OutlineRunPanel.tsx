/**
 * 📖按大纲写的「本次生成几章」弹层——桌面指挥条与手机写作页共用。
 *
 * 背景（用户反馈 2026-11-27：不要一次写满 12 章）：桌面此前有弹层（默认 3 章），
 * 手机端没有——点「按大纲写」直接写满全部大纲。抽成共用组件后两端行为一致。
 */
import { useState } from 'react';

const inputCls =
  'h-9 w-20 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-sm outline-none focus:border-[hsl(var(--accent))]';

export default function OutlineRunPanel({ onStart }: { onStart: (limit: number) => void }) {
  const [limit, setLimit] = useState(3);
  const safe = Math.max(1, Math.min(99, Math.floor(Number(limit) || 3)));
  return (
    <div
      data-testid="outline-panel"
      className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2"
    >
      <span className="shrink-0 text-xs text-[hsl(var(--fg-muted))]">本次按大纲生成</span>
      <input
        type="number"
        min={1}
        max={99}
        value={limit}
        onChange={(e) => setLimit(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
        data-testid="outline-limit-input"
        aria-label="本次生成章数"
        className={inputCls}
      />
      <span className="shrink-0 text-xs text-[hsl(var(--fg-muted))]">章（默认 3，可随时停止）</span>
      <button
        type="button"
        onClick={() => onStart(safe)}
        data-testid="outline-start"
        className="ml-auto h-9 shrink-0 rounded-lg bg-[hsl(var(--accent))] px-4 text-xs font-medium text-[hsl(var(--accent-fg))]"
      >
        开始
      </button>
    </div>
  );
}
