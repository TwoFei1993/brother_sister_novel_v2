/**
 * COT 状态变量面板（C 工作台侧栏，设计 §5.3/§7.1）
 *
 * - 渲染最新 assistant 消息 extra.statusSnapshot（键值对卡片）
 * - 数值型变量带进度条：约定 [0,100] 按百分比分宽，越界 clamp（酒馆状态栏惯例）
 * - 对比上一条 assistant 快照：数值升 ▲ 绿 / 降 ▼ 红 / 持平不标；字符串变更 ~ 灰
 * - 无快照：引导文案（世界书状态栏条目尚未生效时）
 */

export type SnapshotValue = string | number;

export interface StatusPanelProps {
  /** 最新 assistant 消息的 extra.statusSnapshot（无则 null） */
  snapshot: Record<string, SnapshotValue> | null;
  /** 上一条 assistant 消息的快照（对比变化用，无则 null） */
  prevSnapshot: Record<string, SnapshotValue> | null;
}

/** 数值进度百分比：[0,100] 线性映射，越界 clamp 到 0-100 */
function pctOf(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** 变化徽标：数值比较 delta，字符串比较相等性 */
function DeltaBadge({
  current,
  prev,
}: {
  current: SnapshotValue;
  prev: SnapshotValue | undefined;
}) {
  if (prev === undefined) return null;
  if (typeof current === 'number' && typeof prev === 'number') {
    const delta = current - prev;
    if (delta === 0) return null;
    const up = delta > 0;
    return (
      <span
        data-testid={`delta-${up ? 'up' : 'down'}`}
        className={`ml-auto shrink-0 text-xs font-medium ${up ? 'text-emerald-600' : 'text-[hsl(var(--danger))]'}`}
      >
        {up ? '▲' : '▼'}
        {Math.abs(delta)}
      </span>
    );
  }
  if (current !== prev) {
    return (
      <span data-testid="delta-changed" className="ml-auto shrink-0 text-xs text-[hsl(var(--fg-muted))]">
        ~
      </span>
    );
  }
  return null;
}

export default function StatusPanel({ snapshot, prevSnapshot }: StatusPanelProps) {
  if (!snapshot || Object.keys(snapshot).length === 0) {
    return (
      <section aria-label="状态变量" data-testid="status-panel" className="px-3 py-2">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-[hsl(var(--fg-muted))]">状态变量</h3>
        <p className="rounded-lg border border-dashed border-[hsl(var(--border-soft))] p-3 text-xs leading-relaxed text-[hsl(var(--fg-muted))]">
          在世界书添加状态栏条目后，AI 每章末尾输出的变量会显示在这里
        </p>
      </section>
    );
  }

  return (
    <section aria-label="状态变量" data-testid="status-panel" className="px-3 py-2">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-[hsl(var(--fg-muted))]">状态变量</h3>
      <div className="space-y-1.5">
        {Object.entries(snapshot).map(([key, value]) => (
          <div key={key} className="rounded-lg border border-[hsl(var(--border-soft))] px-2.5 py-1.5">
            <div className="flex min-h-5 items-center gap-1">
              <span className="min-w-0 shrink truncate text-xs text-[hsl(var(--fg-muted))]" title={key}>
                {key}
              </span>
              <DeltaBadge current={value} prev={prevSnapshot?.[key]} />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{value}</span>
            </div>
            {typeof value === 'number' && (
              <div
                data-testid="status-bar"
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--surface))]"
                role="progressbar"
                aria-valuenow={value}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-[hsl(var(--accent))] transition-[width] duration-300"
                  style={{ width: `${pctOf(value)}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
