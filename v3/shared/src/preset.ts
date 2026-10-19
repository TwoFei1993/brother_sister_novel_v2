/**
 * 内部预设资产格式（设计 §4.1 presets/<id>.json）
 *
 * raw 存酒馆原生格式（prompts + prompt_order + 采样参数），原样保存。
 * 装配时 prompt_order 取 character_id===100001 的排序列表（设计 §4.7）。
 */
import { z } from 'zod';
import { TavernPresetSchema } from './tavern';

export const PresetAssetSchema = z.strictObject({
  id: z.string().min(1),
  /** 列表展示名 */
  name: z.string(),
  /** 入库时间（毫秒时间戳；服务端生成，列表排序用） */
  createdAt: z.number().optional(),
  /** 酒馆原生预设文件 */
  raw: TavernPresetSchema,
});

export type PresetAsset = z.infer<typeof PresetAssetSchema>;
