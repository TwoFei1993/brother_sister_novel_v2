/**
 * 资产库四类 Tab 容器（受控组件）
 *
 * Tab 状态由 LibraryPage 持有并同步 URL query（?tab=presets 深链可达），
 * 本组件只负责渲染与上报选择，便于单测。
 */
import { ASSET_META, type AssetType } from '../../api/library';

interface AssetTabsProps {
  value: AssetType;
  onChange: (type: AssetType) => void;
}

export default function AssetTabs({ value, onChange }: AssetTabsProps) {
  return (
    <nav aria-label="资产分类" className="mb-5 flex flex-wrap gap-2">
      {ASSET_META.map((meta) => (
        <button
          key={meta.id}
          type="button"
          aria-current={value === meta.id ? 'true' : undefined}
          data-tab={meta.id}
          onClick={() => onChange(meta.id)}
          className={`min-h-[36px] flex-1 rounded-lg border px-3 text-sm transition-colors ${
            value === meta.id
              ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/15 font-medium text-[hsl(var(--accent))]'
              : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))] hover:border-[hsl(var(--accent))]'
          }`}
        >
          {meta.label}
        </button>
      ))}
    </nav>
  );
}
