/**
 * 内部世界书资产格式（设计 §4.1 worldbooks/<id>.json）
 *
 * raw 存酒馆原生格式（entries 表），字段一一对应，导入导出零转换损耗。
 */
import { z } from 'zod';
import { TavernWorldInfoFileSchema } from './tavern';

export const WorldbookAssetSchema = z.strictObject({
  id: z.string().min(1),
  /** 列表展示名（即酒馆世界书名） */
  name: z.string(),
  /** 酒馆原生世界书文件 { entries: { "<uid>": entry } } */
  raw: TavernWorldInfoFileSchema,
});

export type WorldbookAsset = z.infer<typeof WorldbookAssetSchema>;
