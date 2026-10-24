/**
 * 待绑定素材确认流（P2.2）：AI 检出的新角色/势力/世界观 → 一键入库并绑定到本书
 *
 * - 建实体：kind→对应资产端点（character/faction；worldview 落世界书单条目）
 * - 绑定：PATCH work.bindings 追加 active 记录（fromChapter=检出章），实体 origin=本书
 * - 幂等：重试时同名实体以 POST 的幂等语义兜底（角色卡按 name 幂等回既有）
 */
import { apiFetch } from '../../../api/client';
import { uuid } from '../../../lib/uuid';
import { bookOrigin } from '@shared/assets/origin';
import type { FactionAsset } from '@shared/assets/faction';
import type { DetectedAsset } from '@shared/message';
import type { AssetBinding, Work } from '@shared/work';

function endpointOf(kind: DetectedAsset['kind']): string {
  return kind === 'character' ? '/api/characters' : kind === 'faction' ? '/api/factions' : '/api/worldbooks';
}

/** 按检出条目构造初始实体体（kind 各异；worldview 塞世界书单条目） */
function assetBody(workId: string, d: DetectedAsset): Record<string, unknown> {
  if (d.kind === 'character') {
    return {
      name: d.name,
      origin: bookOrigin(workId),
      card: { spec: 'chara_card_v2', spec_version: '2.0', data: { name: d.name, description: d.summary } },
    };
  }
  if (d.kind === 'faction') {
    return { name: d.name, description: d.summary, origin: bookOrigin(workId) } satisfies Partial<FactionAsset>;
  }
  return {
    name: d.name,
    origin: bookOrigin(workId),
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

/** 建实体 + 写绑定；返回新素材 id（实体创建失败抛错由调用方提示） */
export async function confirmPendingAsset(
  work: Work,
  d: DetectedAsset,
  fromChapter: number,
): Promise<string> {
  const created = await apiFetch<{ id: string }>(endpointOf(d.kind), {
    method: 'POST',
    body: JSON.stringify(assetBody(work.id, d)),
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

/** 测试/乐观 UI 用：生成一个待绑定记录形状 */
export function pendingBinding(assetId: string, kind: AssetBinding['kind'], fromChapter: number): AssetBinding {
  return { assetId, kind, fromChapter, status: 'pending', note: '待确认' };
}

export { uuid };
