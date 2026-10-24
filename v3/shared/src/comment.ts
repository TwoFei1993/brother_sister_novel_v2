/**
 * 划线评论模型（安卓 app Phase1，共识 D7：文本快照锚 + 失效降级）
 *
 * 一条评论 = 作者在某章某版本的某句原文上的审稿笔记（改错/添加/感悟）。
 * 定位：优先 (chapterMsgId, versionId, paraIndex)，失效则全文搜 quote；
 * 两步皆败由前端标记「原文已变」，评论不丢、可手动重新锚定。
 */
import { z } from 'zod';

/** 评论类型：改错=纠错 / 添加=增补建议 / 感悟=读后感 */
export const CommentTypeSchema = z.enum(['改错', '添加', '感悟']);
export type CommentType = z.infer<typeof CommentTypeSchema>;

export const CommentSchema = z.strictObject({
  /** 前端生成 uuid，入库幂等键 */
  id: z.string().min(1),
  /** 评论者身份（Phase3；缺省=Phase1 旧数据作者本人） */
  author: z
    .object({ uid: z.string().min(1), name: z.string().min(1) })
    .strict()
    .optional(),
  /** 锚定章节（=消息 id，章节可能重写但消息 id 稳定） */
  chapterMsgId: z.string().min(1),
  /** 冗余章号（总结列表展示，免回查消息） */
  chapterIndex: z.number().int(),
  /** 锚定版本 id（换版本后旧评论折叠为历史批注的判据） */
  versionId: z.string().min(1),
  /** 冗余版本名（展示） */
  versionName: z.string(),
  /** 锚定段落序号（正文按换行切分） */
  paraIndex: z.number().int().nonnegative(),
  /** 引用原文快照（划线文本，含前后少量上下文由前端截取） */
  quote: z.string().min(1),
  type: CommentTypeSchema,
  /** 评论正文 */
  text: z.string(),
  createdAt: z.number(),
});
export type Comment = z.infer<typeof CommentSchema>;
