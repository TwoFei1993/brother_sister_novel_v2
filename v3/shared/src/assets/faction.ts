/**
 * 势力介绍资产（安卓 app Phase2 新增素材类型，共识 D4）
 *
 * 与角色卡/世界书同模型：全局池 JSON 文件 + 可选归属三态 + Work 按 factionIds 绑定。
 * 结构刻意扁平（description/members/relations 三段纯文本）：生成管线按整块注入提示词，
 * 待绑定检测按 name 识别，无需酒馆原生格式的逐条激活语义。
 */
import { z } from 'zod';

import { AssetOriginSchema } from './origin';

export const FactionAssetSchema = z.strictObject({
  id: z.string().min(1),
  /** 势力名（如「青云宗」「星盟」） */
  name: z.string(),
  /** 入库时间（毫秒时间戳；服务端生成） */
  createdAt: z.number().optional(),
  /** 势力描述：定位/立场/实力/目标等 */
  description: z.string(),
  /** 主要成员（角色名列表，纯文本即可） */
  members: z.array(z.string()).optional(),
  /** 与其他势力的关系（自由文本） */
  relations: z.string().optional(),
  /** 归属三态（可选，缺省=无归属） */
  origin: AssetOriginSchema.optional(),
});

export type FactionAsset = z.infer<typeof FactionAssetSchema>;

export const DEFAULT_FACTION = (): Omit<FactionAsset, 'id'> => ({
  name: '',
  description: '',
});
