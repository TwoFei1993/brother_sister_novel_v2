/**
 * 统一消息模型（设计 §4.2）
 *
 * 内部格式：strict 严格校验——未知字段视为拼写错误直接拒绝，防止脏数据入库。
 * 消息流一行一条存 messages.jsonl；id 由前端生成（uuid），入库幂等键。
 */
import { z } from 'zod';

/** 消息角色：user=作者指令（novel）/用户对话（chat），assistant=AI 正文 */
export const MessageRoleSchema = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/** novel 模式章节元数据：此消息 = 一章 */
export const MessageChapterSchema = z
  .object({
    index: z.number().int().nonnegative(),
    title: z.string(),
  })
  .strict();
export type MessageChapter = z.infer<typeof MessageChapterSchema>;

/** 生成附加信息：审计与统计，非核心语义字段 */
export const MessageExtraSchema = z
  .object({
    model: z.string().optional(),
    tokenCount: z.number().optional(),
    generationMs: z.number().optional(),
    /** COT 状态快照（C 工作台变量面板） */
    statusSnapshot: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    /** 本次生成激活的世界书条目 uid 审计 */
    activatedEntries: z.array(z.string()).optional(),
    /** 模型思考流原文（用户反馈⑨：从 <think>/<thinking> 块捕获，前端折叠展示；仅审计不进正文） */
    rawThinking: z.string().optional(),
  })
  .strict();
export type MessageExtra = z.infer<typeof MessageExtraSchema>;

export const MessageSchema = z
  .object({
    /** 前端生成的 uuid，入库幂等键 */
    id: z.string().min(1),
    role: MessageRoleSchema,
    /** "作者" / "小说家" / 角色名（chat 模式=激活角色） */
    name: z.string(),
    content: z.string(),
    createdAt: z.number(),
    /** 消息级分支候选（swipe），上限可配默认 20 */
    swipes: z.array(z.string()),
    /** 当前选中的 swipe 下标 */
    swipeId: z.number().int().nonnegative(),
    chapter: MessageChapterSchema.optional(),
    /** novel 模式：生成本章时的剧情指令 */
    directive: z.string().optional(),
    extra: MessageExtraSchema,
  })
  .strict();

export type Message = z.infer<typeof MessageSchema>;
