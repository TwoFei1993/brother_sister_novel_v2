/**
 * 跨书素材复制路由（安卓 app Phase2，共识 D4：纯复制不共享）
 *
 * POST /api/library/copy { assetType, assetIds[], targetBookId }
 * → 每个源资产深拷贝为新实体（新 uuid、名加「（副本）」、origin=目标书），原实体零改动。
 * 语义：两本书各自独立演进；批量一次请求（勾选多条复制）。
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { zodBody } from '../../middleware/validate';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { FactionAssetSchema } from '@shared/assets/faction';
import { bookOrigin } from '@shared/assets/origin';
import { CharacterAssetSchema } from '@shared/card';
import { WorldbookAssetSchema } from '@shared/worldbook';

import { libraryDir } from './crud';

const COPY_TYPES = ['characters', 'worldbooks', 'factions'] as const;
type CopyType = (typeof COPY_TYPES)[number];

const CopySchema = z.strictObject({
  assetType: z.enum(COPY_TYPES),
  assetIds: z.array(z.string().min(1)).min(1).max(100),
  targetBookId: z.string().min(1),
});

const SCHEMAS: Record<CopyType, typeof CharacterAssetSchema | typeof WorldbookAssetSchema | typeof FactionAssetSchema> = {
  characters: CharacterAssetSchema,
  worldbooks: WorldbookAssetSchema,
  factions: FactionAssetSchema,
};

/** 复制单个资产：新 id + 「（副本）」名 + origin=目标书；返回新实体（含 id） */
export async function copyAsset(assetType: CopyType, assetId: string, targetBookId: string): Promise<{ id: string; name: string } | null> {
  const source = await readJson<Record<string, unknown>>(join(libraryDir(assetType), `${assetId}.json`));
  if (!source) return null;
  const parsed = SCHEMAS[assetType].parse(source) as { name: string; [k: string]: unknown };
  const copy = { ...parsed, id: randomUUID(), name: `${parsed.name}（副本）`, origin: bookOrigin(targetBookId) };
  await writeJsonAtomic(join(libraryDir(assetType), `${copy.id}.json`), copy);
  return { id: copy.id, name: copy.name };
}

export const copyAssets: RequestHandler = async (req, res, next) => {
  try {
    const { assetType, assetIds, targetBookId } = req.body as z.infer<typeof CopySchema>;
    const created: { id: string; name: string }[] = [];
    const missing: string[] = [];
    for (const assetId of assetIds) {
      const result = await copyAsset(assetType, assetId, targetBookId);
      if (result) created.push(result);
      else missing.push(assetId);
    }
    if (created.length === 0 && missing.length > 0) {
      res.status(404).json({ error: '素材不存在，复制失败', missing });
      return;
    }
    res.json({ created, missing });
  } catch (err) {
    next(err);
  }
};

export const copyRouter = Router();
copyRouter.post('/', zodBody(CopySchema), copyAssets);
