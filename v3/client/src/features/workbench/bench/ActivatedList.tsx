/**
 * 世界书激活指示灯（C 工作台侧栏，设计 §5.2/§7.1）
 *
 * - 展示父层解析好的条目索引 entries（id 形如 "bookId:uid"），组件纯渲染
 * - 最新 assistant 消息 extra.activatedEntries 命中的条目点亮（绿点），未命中灰暗
 * - 激活了索引之外的 id（如卡 system_prompt 覆盖记录）以"未登记"灰黄条目附列
 * - 无激活审计数据：引导提示
 */

export interface WorldbookEntryRef {
  /** "bookId:uid" 形态的条目 id（与 extra.activatedEntries 一致） */
  id: string;
  /** 条目显示名（父层从 worldbook raw 取 comment/键名解析） */
  label: string;
}

export interface ActivatedListProps {
  /** 最新 assistant 消息的 extra.activatedEntries（无则 null） */
  activatedIds: string[] | null;
  /** 全量世界书条目索引（父层解析，组件纯渲染） */
  entries: WorldbookEntryRef[];
}

export default function ActivatedList({ activatedIds, entries }: ActivatedListProps) {
  if (activatedIds === null) {
    return (
      <section aria-label="世界书激活" data-testid="activated-list" className="px-3 py-2">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-[hsl(var(--fg-muted))]">世界书激活</h3>
        <p className="rounded-lg border border-dashed border-[hsl(var(--border-soft))] p-3 text-xs leading-relaxed text-[hsl(var(--fg-muted))]">
          生成一次章节后，这里会显示本次被激活的世界书条目
        </p>
      </section>
    );
  }

  const activated = new Set(activatedIds);
  const unknown = activatedIds.filter((id) => !entries.some((e) => e.id === id));

  return (
    <section aria-label="世界书激活" data-testid="activated-list" className="px-3 py-2">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-[hsl(var(--fg-muted))]">
        世界书激活
        <span className="font-normal">
          {activated.size}/{Math.max(entries.length, activated.size)}
        </span>
      </h3>
      {entries.length === 0 && unknown.length === 0 && (
        <p className="py-2 text-xs text-[hsl(var(--fg-muted))]">未绑定世界书</p>
      )}
      <ul className="space-y-1">
        {entries.map((e) => {
          const on = activated.has(e.id);
          return (
            <li
              key={e.id}
              data-testid="entry-item"
              data-active={on ? 'true' : 'false'}
              className={`flex min-h-9 items-center gap-2 rounded px-1.5 text-xs ${on ? 'bg-[hsl(var(--accent))]/10' : 'opacity-50'}`}
              title={e.id}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${on ? 'bg-emerald-500' : 'bg-[hsl(var(--fg-muted))]'}`}
              />
              <span className={`min-w-0 truncate ${on ? 'font-medium text-[hsl(var(--fg))]' : 'text-[hsl(var(--fg-muted))]'}`}>
                {e.label}
              </span>
            </li>
          );
        })}
        {unknown.map((id) => (
          <li
            key={id}
            data-testid="entry-unknown"
            className="flex min-h-9 items-center gap-2 rounded bg-amber-500/10 px-1.5 text-xs text-amber-600"
            title={`未在已绑定世界书中找到：${id}`}
          >
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
            <span className="min-w-0 truncate">{id}（未登记）</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
