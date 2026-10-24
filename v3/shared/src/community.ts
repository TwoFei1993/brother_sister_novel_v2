/**
 * 用户与沟通模式模型（安卓 app Phase3，共识 D1/Phase3）
 *
 * 账号体系：单一作者 + 多读者（权限分级，数据布局不变——作品/素材都是作者的）。
 * 密码哈希只存 server 端 users.jsonl，shared 只暴露公开形状。
 */
import { z } from 'zod';

/** 用户公开形状（不含凭证） */
export const UserSchema = z.strictObject({
  id: z.string().min(1),
  username: z.string().min(1),
  /** 展示名（评论/留言署名；缺省=username） */
  displayName: z.string().optional(),
  role: z.enum(['author', 'reader']),
  createdAt: z.number(),
});
export type User = z.infer<typeof UserSchema>;

/** 留言板条目类型（共识 P3.2：留言 / 系统建议 / 想看的书） */
export const BoardTypeSchema = z.enum(['留言', '建议', '想看']);
export type BoardType = z.infer<typeof BoardTypeSchema>;

/** 留言板条目：登录用户可发，作者可回复；删除=作者或本人 */
export const BoardEntrySchema = z.strictObject({
  id: z.string().min(1),
  author: z
    .object({ uid: z.string().min(1), name: z.string().min(1) })
    .strict(),
  type: BoardTypeSchema,
  text: z.string().min(1),
  /** 作者回复（可空） */
  reply: z
    .object({ name: z.string().min(1), text: z.string().min(1), at: z.number() })
    .strict()
    .optional(),
  createdAt: z.number(),
});
export type BoardEntry = z.infer<typeof BoardEntrySchema>;
