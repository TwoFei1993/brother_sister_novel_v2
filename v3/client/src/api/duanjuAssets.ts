/**
 * 短剧资产库 API（discuss/2026-11-18-短剧资产库设计.md）
 * 三类资产：characters / scenes / styles；路由挂 /api/library/duanju-assets。
 */
import { apiFetch } from './client';

import type { DuanjuAssetType } from '@shared/duanju-asset';

export type DuanjuAssetSummary = { id: string; name: string };

export function listDuanjuAssets(type: DuanjuAssetType): Promise<DuanjuAssetSummary[]> {
  return apiFetch<DuanjuAssetSummary[]>(`/api/library/duanju-assets/${type}`);
}

export function getDuanjuAsset<T>(type: DuanjuAssetType, id: string): Promise<T> {
  return apiFetch<T>(`/api/library/duanju-assets/${type}/${id}`);
}

export function importDuanjuAssets(
  workId: string, type: DuanjuAssetType, scanImages = true,
): Promise<{ imported: string[]; skipped: string[] }> {
  return apiFetch(`/api/library/duanju-assets/import-from/${workId}`, {
    method: 'POST',
    body: JSON.stringify({ type, scanImages }),
  });
}

export function duanjuAssetToWork(
  type: DuanjuAssetType, assetId: string, workId: string,
): Promise<{ applied: string; newId?: string }> {
  return apiFetch(`/api/library/duanju-assets/${type}/${assetId}/to-work/${workId}`, { method: 'POST' });
}

/** 资产图片 URL（StoredImage.path 取文件名段；server 白名单防穿越） */
export function duanjuAssetFileUrl(type: DuanjuAssetType, assetId: string, path: string): string {
  const name = path.split('/').pop() ?? '';
  return `/api/library/duanju-assets/files/${type}/${assetId}/${encodeURIComponent(name)}`;
}
