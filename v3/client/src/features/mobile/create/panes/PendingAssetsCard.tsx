/**
 * 待绑定素材确认流（P2.2 / D8，UI 与入库逻辑同域合并）：
 *
 * - 确认卡：本章 AI 检出的新角色/势力/世界观，逐条入库并绑定到本书；
 *   「共享入库」勾选后不归属本书（跨书可见的共享素材）
 * - confirmPendingAsset：建实体（kind→对应资产端点；worldview 落世界书单条目）→
 *   PATCH work.bindings 追加 active 记录（fromChapter=检出章）→ 返回新素材 id；
 *   幂等：重试时同名实体以 POST 的幂等语义兜底（角色卡按 name 幂等回既有）
 */
import { apiFetch } from '../../../../api/client';
import { bookOrigin } from '@shared/assets/origin';
import type { FactionAsset } from '@shared/assets/faction';
import type { DetectedAsset } from '@shared/message';
import type { AssetBinding, Work } from '@shared/work';

function endpointOf(kind: DetectedAsset['kind']): string {
  return kind === 'character' ? '/api/characters' : kind === 'faction' ? '/api/factions' : '/api/worldbooks';
}

/** 按检出条目构造初始实体体（kind 各异；worldview 塞世界书单条目；shared=共享素材不归属本书） */
function assetBody(workId: string, d: DetectedAsset, shared: boolean): Record<string, unknown> {
  if (d.kind === 'character') {
    return {
      name: d.name,
      ...(shared ? {} : { origin: bookOrigin(workId) }),
      card: { spec: 'chara_card_v2', spec_version: '2.0', data: { name: d.name, description: d.summary } },
    };
  }
  if (d.kind === 'faction') {
    return { name: d.name, description: d.summary, ...(shared ? {} : { origin: bookOrigin(workId) }) } satisfies Partial<FactionAsset>;
  }
  return {
    name: d.name,
    ...(shared ? {} : { origin: bookOrigin(workId) }),
    raw: {
      entries: {
        '0': {
          uid: 0,
          key: [d.name],
          content: d.summary,
          enabled: true,
          insertion_order: 100,
          constant: false,
        },
      },
    },
  };
}

/** 建实体 + 写绑定；返回新素材 id（实体创建失败抛错由调用方提示；shared=共享入库，不归属本书） */
export async function confirmPendingAsset(
  work: Work,
  d: DetectedAsset,
  fromChapter: number,
  shared = false,
): Promise<string> {
  const created = await apiFetch<{ id: string }>(endpointOf(d.kind), {
    method: 'POST',
    body: JSON.stringify(assetBody(work.id, d, shared)),
  });
  // 绑定写回：取最新 work（乐观锁），追加 active 绑定
  const latest = await apiFetch<Work>(`/api/works/${work.id}`);
  const binding: AssetBinding = {
    assetId: created.id,
    kind: d.kind === 'worldview' ? 'worldbook' : d.kind,
    fromChapter,
    status: 'active',
    note: `第${fromChapter}章首次出现（AI 检测）`,
  };
  await apiFetch(`/api/works/${work.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      revision: latest.revision,
      bindings: [...(latest.bindings ?? []), binding],
    }),
  });
  return created.id;
}

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
