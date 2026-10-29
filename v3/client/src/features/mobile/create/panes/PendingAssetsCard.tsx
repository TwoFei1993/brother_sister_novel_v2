/**
 * 待绑定确认卡（D8）：本章 AI 检出的新角色/势力/世界观，逐条入库并绑定；
 * 「共享入库」勾选后不归属本书（跨书可见的共享素材）。
 */
import type { DetectedAsset } from '@shared/message';

interface Props {
  list: readonly DetectedAsset[];
  sharedImport: boolean;
  onSharedImport: (v: boolean) => void;
  onConfirm: (d: DetectedAsset) => void;
  onDismiss: (d: DetectedAsset) => void;
}

export function PendingAssetsCard({ list, sharedImport, onSharedImport, onConfirm, onDismiss }: Props) {
  if (list.length === 0) return null;
  return (
    <div className="mx-4 mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3" data-testid="pending-assets">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
          本章检出 {list.length} 个新素材，确认后入库并绑定到本书
        </p>
        <label className="flex shrink-0 items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <input
            type="checkbox"
            checked={sharedImport}
            onChange={(e) => onSharedImport(e.target.checked)}
            data-testid="shared-import-check"
          />
          共享入库
        </label>
      </div>
      <ul className="flex flex-col gap-1.5">
        {list.map((d) => (
          <li key={d.name} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{d.name}</span>
              <span className="ml-1 text-[hsl(var(--fg-muted))]">
                （{d.kind === 'character' ? '角色' : d.kind === 'faction' ? '势力' : '世界观'}）{d.summary.slice(0, 24)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onConfirm(d)}
              data-testid={`confirm-asset-${d.name}`}
              className="shrink-0 rounded-lg border border-amber-500/50 px-2 py-1 text-amber-700 dark:text-amber-400"
            >
              入库并绑定
            </button>
            <button
              type="button"
              onClick={() => onDismiss(d)}
              className="shrink-0 rounded-lg px-2 py-1 text-[hsl(var(--fg-muted))]"
            >
              忽略
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
