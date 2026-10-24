/**
 * 素材归属三态（安卓 app Phase2，共识 D4）
 *
 * 每个素材（角色卡/世界书/势力介绍）可选携带归属：
 * - book：原归属于某本书（按 bookId 引用，展示时解析书名——书改名自然跟随，不存快照）
 * - external：来自外部书籍/开源等（note 标注来源）
 * - none：无归属自由素材
 * 缺省（字段缺位）= none 的旧数据兼容形态。
 * 跨书复用一律「复制」：深拷贝出新实体、origin 指向目标书，两本书独立演进（纯复制不共享）。
 */
import { z } from 'zod';

export const AssetOriginSchema = z.union([
  z
    .object({ type: z.literal('book'), bookId: z.string().min(1) })
    .strict(),
  z
    .object({ type: z.literal('external'), note: z.string().min(1) })
    .strict(),
  z.object({ type: z.literal('none') }).strict(),
]);
export type AssetOrigin = z.infer<typeof AssetOriginSchema>;

/** 构造归属到某本书的 origin */
export function bookOrigin(bookId: string): AssetOrigin {
  return { type: 'book', bookId };
}

/** 归属展示文案（书名由调用方按 bookId 解析后传入） */
export function originLabel(origin: AssetOrigin | undefined, bookTitle?: string): string {
  if (!origin || origin.type === 'none') return '无归属';
  if (origin.type === 'external') return `外部：${origin.note}`;
  return bookTitle ? `《${bookTitle}》` : '某本书';
}
