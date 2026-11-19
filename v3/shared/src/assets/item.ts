/**
 * 物品道具资产（用户需求：特殊物品道具也有资料卡，描述具体到质感/形状/颜色/功能/承载感情）
 *
 * 与势力介绍同模型：全局池 JSON 文件 + 可选归属三态 + Work 按 itemIds 绑定。
 * 结构刻意扁平（七段纯文本）：生成管线按整块注入提示词（buildItemBook 伪世界书条目），
 * 无酒馆原生格式的逐条激活语义。字段可留空——注入时只拼非空段。
 */
import { z } from 'zod';

import { AssetOriginSchema } from './origin';

export const ItemAssetSchema = z.strictObject({
  id: z.string().min(1),
  /** 物品名（如「母亲的银锁」「星陨剑」） */
  name: z.string(),
  /** 入库时间（毫秒时间戳；服务端生成） */
  createdAt: z.number().optional(),
  /** 一句话定位：这是什么、特殊在哪（注入时的引导句） */
  summary: z.string(),
  /** 主人：物品归属角色（用户要求：所有物品必须有主人，无明确主人写「无」；旧数据 parse 自动补「无」） */
  owner: z.string().default('无'),
  /** 质感：触感/材质（如「温润的羊脂玉触感」） */
  texture: z.string().optional(),
  /** 形状：外形/尺寸/结构 */
  shape: z.string().optional(),
  /** 颜色：色彩与光泽 */
  color: z.string().optional(),
  /** 功能：用途/能力/机制（含限制与代价） */
  usage: z.string().optional(),
  /** 承载的感情：情感意义/回忆/羁绊（驱动剧情的钩子） */
  emotion: z.string().optional(),
  /** 其他备注：来历/禁忌/伏笔等自由补充 */
  notes: z.string().optional(),
  /** 归属三态（可选，缺省=无归属） */
  origin: AssetOriginSchema.optional(),
});

export type ItemAsset = z.infer<typeof ItemAssetSchema>;

export const DEFAULT_ITEM = (): Omit<ItemAsset, 'id'> => ({
  name: '',
  summary: '',
  owner: '无',
});

/** 拼物品的注入描述（只拼非空段；主人段始终输出——无主人写「无」，用户要求） */
export function describeItem(it: Omit<ItemAsset, 'id' | 'createdAt' | 'origin'>): string {
  const segs: string[] = [];
  if (it.summary.trim()) segs.push(it.summary.trim());
  const owner = (it.owner ?? '').trim() || '无';
  segs.push(`主人：${owner}`);
  const fields: ReadonlyArray<[string, string | undefined]> = [
    ['质感', it.texture],
    ['形状', it.shape],
    ['颜色', it.color],
    ['功能', it.usage],
    ['承载感情', it.emotion],
    ['备注', it.notes],
  ];
  for (const [label, value] of fields) {
    const v = (value ?? '').trim();
    if (v) segs.push(`${label}：${v}`);
  }
  return segs.join('；');
}
