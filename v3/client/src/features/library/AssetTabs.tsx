/**
 * 资产库 Tab 容器（受控组件）：四类资产 + 资源中心（Task 30）。
 *
 * Tab 状态由 LibraryPage 持有并同步 URL query（?tab=presets 深链可达），
 * 本组件只负责渲染与上报选择，便于单测。
 */
import { ASSET_META, type AssetType } from '../../api/library';

/** Tab 值：四类资产 id 或资源中心（hub） */
export type LibraryTab = AssetType | 'hub';

interface AssetTabsProps {
  value: LibraryTab;
  onChange: (tab: LibraryTab) => void;
}

const TAB_ITEMS: ReadonlyArray<{ id: LibraryTab; label: string }> = [
  ...ASSET_META.map((m) => ({ id: m.id as LibraryTab, label: m.label })),
  { id: 'hub', label: '资源中心' },
];

export default function AssetTabs({ value, onChange }: AssetTabsProps) {
  return (
    <nav
      aria-label="资产分类"
      className="mb-5 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TAB_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={value === item.id ? 'true' : undefined}
          data-tab={item.id}
          onClick={() => onChange(item.id)}
          className={`min-h-[36px] shrink-0 whitespace-nowrap rounded-lg border px-3 text-sm transition-colors ${
            value === item.id
              ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/15 font-medium text-[hsl(var(--accent))]'
              : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))] hover:border-[hsl(var(--accent))]'
          }`}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
