/**
 * 内部角色卡资产格式（设计 §4.1 characters/<id>.json）
 *
 * 壳层字段自有（strict），card 字段引用酒馆原生 V2 schema（passthrough 宽松）。
 * PNG 导入导出时只转换壳外的 card 部分。
 */
import { z } from 'zod';
import { TavernCardV2Schema } from './tavern';
import { AssetOriginSchema } from './assets/origin';

export const CharacterAssetSchema = z.strictObject({
  id: z.string().min(1),
  /** 列表展示名（冗余自 card.data.name，导入时同步） */
  name: z.string(),
  /** 入库时间（毫秒时间戳；服务端生成，列表排序用） */
  createdAt: z.number().optional(),
  /** 头像引用（data URL 或相对路径，可空） */
  avatar: z.string().optional(),
  /** 归属三态（可选，缺省=无归属；安卓 app Phase2） */
  origin: AssetOriginSchema.optional(),
  /** 酒馆原生 V2 卡（含 spec/spec_version/data 全量字段，原样保存） */
  card: TavernCardV2Schema,
});

export type CharacterAsset = z.infer<typeof CharacterAssetSchema>;
