/**
 * 短剧资产库数据模型（discuss/2026-11-18-短剧资产库设计.md）
 *
 * 三类资产（角色/场景/风格签名），复用 duanju.ts 的实体 schema（字段平移即导入导出）：
 * - DuanjuCharacterAsset = DuanjuCharacter + tags + sourceWorkId
 * - DuanjuSceneAsset    = DuanjuScene + tags + sourceWorkId
 * - DuanjuStyleAsset    = 作品顶层 style + visualSignature 的独立化
 *
 * 图片路径语义差异（重要）：
 * 作品内 StoredImage.path 相对 work 目录（duanju/images/xx.png）；
 * 资产库内 StoredImage.path 相对 DATA_DIR（duanju-assets/files/<type>/<assetId>/xx.png）。
 * 导入/导出动作负责文件复制与 path 改写，schema 本身不变。
 */
import { z } from 'zod';

import { DuanjuCharacterSchema, DuanjuSceneSchema, idSchema, tsSchema } from './duanju';

/** 资产库通用扩展字段：tags 供列表过滤，sourceWorkId 记录来源作品（诊断用） */
const assetExtension = {
  tags: z.array(z.string()).default([]),
  sourceWorkId: idSchema.optional(),
};

export const DuanjuCharacterAssetSchema = DuanjuCharacterSchema.extend(assetExtension);
export type DuanjuCharacterAsset = z.infer<typeof DuanjuCharacterAssetSchema>;

export const DuanjuSceneAssetSchema = DuanjuSceneSchema.extend(assetExtension);
export type DuanjuSceneAsset = z.infer<typeof DuanjuSceneAssetSchema>;

/** 风格签名资产：作品顶层两字段的独立化（新作品可整段导入） */
export const DuanjuStyleAssetSchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  /** 全局画风前缀（project.style） */
  style: z.string(),
  /** 逐镜注入的视觉签名（project.visualSignature） */
  visualSignature: z.string(),
  tags: z.array(z.string()).default([]),
  sourceWorkId: idSchema.optional(),
  createdAt: tsSchema.optional(),
  updatedAt: tsSchema,
});
export type DuanjuStyleAsset = z.infer<typeof DuanjuStyleAssetSchema>;

/** 资产类型（路由与目录名共用） */
export const DUANJU_ASSET_TYPES = ['characters', 'scenes', 'styles'] as const;
export type DuanjuAssetType = (typeof DUANJU_ASSET_TYPES)[number];
