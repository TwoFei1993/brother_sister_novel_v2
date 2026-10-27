/**
 * 统一消息模型（设计 §4.2）
 *
 * 内部格式：strict 严格校验——未知字段视为拼写错误直接拒绝，防止脏数据入库。
 * 消息流一行一条存 messages.jsonl；id 由前端生成（uuid），入库幂等键。
 *
 * 版本体系（安卓 app Phase1）：swipes 从 string[] 升级为结构化 MessageVersion[]，
 * 每个版本带命名（同书内唯一，客户端保证）/来源/时间；章节元数据新增 publishedVersionId
 * 上架指针（null/缺省=未上架），与 swipeId（生成基底指针）互不干扰——可基于 v3 草稿续写
 * 而阅读端仍展示 v1。存量 string[] 由 server 启动迁移归一化（services/message-migrate.ts）。
 */
import { z } from 'zod';

/** 消息角色：user=作者指令（novel）/用户对话（chat），assistant=AI 正文 */
export const MessageRoleSchema = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/** 消息级版本（原 swipe 候选的结构化形态） */
export const MessageVersionSchema = z
  .object({
    /** 版本 id（uuid；迁移产物用 randomUUID，重跑幂等由「已结构化即跳过」保证） */
    id: z.string().min(1),
    /** 版本名：AI 生成 v1/v2…，手改「<基底名>手改M」；同书内唯一（客户端校验） */
    name: z.string().min(1),
    content: z.string(),
    /** 来源：ai=模型生成（含重roll追加），手改=复制当前版本后人工修改 */
    origin: z.enum(['ai', '手改']),
    createdAt: z.number(),
  })
  .strict();
export type MessageVersion = z.infer<typeof MessageVersionSchema>;

/** 版本来源：模型生成 / 人工手改 */
export type VersionOrigin = MessageVersion['origin'];

/** novel 模式章节元数据：此消息 = 一章 */
export const MessageChapterSchema = z
  .object({
    index: z.number().int().nonnegative(),
    title: z.string(),
    /** 上架指针：指向本章 swipes 中某个版本的 id；null/缺省=未上架（阅读端不可见） */
    publishedVersionId: z.string().nullable().optional(),
  })
  .strict();
export type MessageChapter = z.infer<typeof MessageChapterSchema>;


/** 生成附加信息：审计与统计，非核心语义字段 */
/** 待绑定检测条目（安卓 app Phase2 side-channel，D8）：模型顺带报告本章新素材 */
export const DetectedAssetSchema = z
  .object({
    /** 素材种类：角色 / 势力 / 世界观（世界观落世界书） */
    kind: z.enum(['character', 'faction', 'worldview']),
    name: z.string().min(1),
    /** 一句话描述（建卡时的初始 description） */
    summary: z.string(),
  })
  .strict();
export type DetectedAsset = z.infer<typeof DetectedAssetSchema>;

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
    /** 本章新素材检测清单（<new_assets> 块解析产物；剥离自正文，作者确认后进素材库） */
    newAssets: z.array(DetectedAssetSchema).optional(),
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
    /** 消息级版本候选（结构化 swipe），上限前端控制默认 50 */
    swipes: z.array(MessageVersionSchema),
    /** 当前选中的版本下标（生成基底指针：写下一章时上下文取它） */
    swipeId: z.number().int().nonnegative(),
    chapter: MessageChapterSchema.optional(),
    /** novel 模式：生成本章时的剧情指令 */
    directive: z.string().optional(),
    extra: MessageExtraSchema,
  })
  .strict();

export type Message = z.infer<typeof MessageSchema>;

// ---------- 版本命名与归一化（纯函数，前后端共用） ----------

const AI_NAME_RE = /^v(\d+)$/;
const MANUAL_SUFFIX_RE = /手改(\d+)$/;

/**
 * 兼容的 UUID v4（非安全上下文兜底）：http://IP:端口 部署下浏览器不提供
 * crypto.randomUUID（调用即抛——第四章生成崩溃的根因），getRandomValues 仍可用，
 * 据 RFC 4122 v4 自行拼装，与原生输出格式一致。
 */
export function randomUUIDSafe(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** 构造一个 AI 来源版本（命名延后由 nextAiVersionName 处理） */
export function aiVersion(content: string, name: string, now = Date.now()): MessageVersion {
  return { id: randomUUIDSafe(), name, content, origin: 'ai', createdAt: now };
}

/** 构造一个手改版本（origin='手改'） */
export function manualVersion(content: string, name: string, now = Date.now()): MessageVersion {
  return { id: randomUUIDSafe(), name, content, origin: '手改', createdAt: now };
}

/**
 * 下一个 AI 版本名：取候选中已有 vN 的最大序号 +1。
 * 手改版本（v2手改1）不占 v 序号——剥离后缀后的基底 v2 不计入，避免跳号。
 */
export function nextAiVersionName(existing: readonly string[]): string {
  let max = 0;
  for (const name of existing) {
    const m = AI_NAME_RE.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `v${max + 1}`;
}

/**
 * 手改版本名：基底名（剥掉已有「手改N」后缀）+「手改M」，M=同基底已有的最大 M+1。
 * 例：v2 → v2手改1；v2手改1 再手改 → v2手改2；纯手改名「初稿」→ 初稿手改1。
 */
export function manualVersionName(base: string, existing: readonly string[]): string {
  const stem = base.replace(MANUAL_SUFFIX_RE, '');
  let max = 0;
  for (const name of existing) {
    if (!name.startsWith(stem)) continue;
    const m = MANUAL_SUFFIX_RE.exec(name);
    if (m && m[0].length === name.length - stem.length) max = Math.max(max, Number(m[1]));
  }
  return `${stem}手改${max + 1}`;
}

/**
 * 存量 swipes 归一化（server 启动迁移用）：string[] → MessageVersion[]（自动命名 v1…）；
 * 已是结构化形态则原样返回（引用不变，调用方据此跳过写回）；其他脏形态兜底单空版本。
 */
export function normalizeSwipes(raw: unknown, now = Date.now()): MessageVersion[] {
  if (!Array.isArray(raw)) return [aiVersion('', 'v1', now)];
  if (raw.every((v) => typeof v === 'string')) {
    const list = raw as string[];
    return list.length > 0 ? list.map((content, i) => aiVersion(content, `v${i + 1}`, now)) : [aiVersion('', 'v1', now)];
  }
  return raw as MessageVersion[];
}
