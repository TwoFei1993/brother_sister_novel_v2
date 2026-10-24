/**
 * 作品模型（设计 §4.3）与小说设定
 *
 * NovelSettings 从旧站 src/types/novel.ts 全量移植（题材/哥妹人设/能力/关系/
 * 体系/势力/矛盾/基调/文风/章数/粘贴大纲），新增 authorNote/noteDepth（作者注释深度注入）。
 * Work 为内部格式：strict 严格校验。
 */
import { z } from 'zod';

// ---------- 旧站枚举（原样移植，中文字面量直接作值） ----------
export const GenreTypeSchema = z.enum([
  'chuanyue',
  'scifi',
  'moshi',
  'wuxian',
  'xuanhuan',
  'hunhe',
  'custom',
]);
export type GenreType = z.infer<typeof GenreTypeSchema>;

export const BrotherPersonalitySchema = z.enum([
  '冷酷腹黑',
  '温柔强大',
  '痞帅不羁',
  '沉稳睿智',
  '偏执危险',
  '表面废物实则无敌',
  '孤傲清冷',
  '疯批危险',
]);
export type BrotherPersonality = z.infer<typeof BrotherPersonalitySchema>;

export const SisterPersonalitySchema = z.enum([
  '表面软萌实则腹黑',
  '天才型',
  '坚韧独立',
  '呆萌可爱',
  '冷静理智',
  '神秘未知身份',
  '外柔内刚',
  '看似普通实则惊艳',
]);
export type SisterPersonality = z.infer<typeof SisterPersonalitySchema>;

export const RelationTypeSchema = z.enum([
  '相互扶持共同成长型',
  '哥哥全力守护妹妹型',
  '妹妹反向救赎哥哥型',
  '各自成长后震撼重逢型',
  '表面互怼实则深厚羁绊型',
]);
export type RelationType = z.infer<typeof RelationTypeSchema>;

export const StoryToneSchema = z.enum([
  '热血爽文',
  '虐中带甜',
  '深度烧脑',
  '恐怖压抑',
  '温情治愈',
  '权谋博弈',
]);
export type StoryTone = z.infer<typeof StoryToneSchema>;

export const WritingStyleSchema = z.enum(['default', 'qidian', 'jjwxc', 'fanqie', 'custom']);
export type WritingStyle = z.infer<typeof WritingStyleSchema>;

// ---------- 小说设定（旧站 NovelSettings 全字段 + authorNote/noteDepth） ----------

/** chat 回复长度档位：short=150-300 字 / medium=400-900 字 / long=800-1500 字 */
export const ChatReplyLengthSchema = z.enum(['short', 'medium', 'long']);
export type ChatReplyLength = z.infer<typeof ChatReplyLengthSchema>;

/** 长度档位缺省值（缺省视为 medium） */
export const DEFAULT_CHAT_REPLY_LENGTH: ChatReplyLength = 'medium';

/** 各档位回复字数区间（单一事实源：兜底主提示词与组装后处理 hint 共用） */
export const CHAT_REPLY_LENGTH_RANGE: Record<ChatReplyLength, { min: number; max: number }> = {
  short: { min: 150, max: 300 },
  medium: { min: 400, max: 900 },
  long: { min: 800, max: 1500 },
};

/** novel 模式每章目标字数缺省值（缺省视为 3000；兜底主提示词与末尾写作要求共用） */
export const DEFAULT_TARGET_CHAPTER_WORDS = 3000;

/** 章节大纲条目（一键导入大纲，Word 实测反馈）：生成第 N 章时按 index 匹配注入本章要点 */
export const ChapterOutlineItemSchema = z.object({
  /** 章号（从 1 起） */
  index: z.number().int(),
  title: z.string(),
  /** 剧情要点 */
  plot: z.string(),
});
export type ChapterOutlineItem = z.infer<typeof ChapterOutlineItemSchema>;

export const NovelSettingsSchema = z.strictObject({
  genre: GenreTypeSchema,
  subGenre: z.string(),
  customGenre: z.string(),
  customSubGenre: z.string(),
  /** 背景备注 */
  backgroundNote: z.string(),
  brotherAge: z.number(),
  brotherPersonalities: z.array(BrotherPersonalitySchema),
  customBrotherPersonality: z.string(),
  brotherAbility: z.string(),
  sisterAge: z.number(),
  sisterPersonalities: z.array(SisterPersonalitySchema),
  customSisterPersonality: z.string(),
  sisterAbility: z.string(),
  relationType: RelationTypeSchema,
  customRelationType: z.string(),
  /** 力量体系 */
  powerSystem: z.string(),
  /** 势力划分 */
  factions: z.string(),
  /** 核心矛盾 */
  coreConflict: z.string(),
  storyTones: z.array(StoryToneSchema),
  customStoryTone: z.string(),
  writingStyle: WritingStyleSchema,
  customWritingStyle: z.string(),
  desiredChapterCount: z.number().int().positive(),
  outlineChapterCount: z.number().int().positive(),
  /** 粘贴的大纲原文 */
  pastedOutline: z.string(),
  /** 旧站迁移专用（Task 31）：原 worldBuilding.content 原文保留；仅迁移写入，新建作品不产生 */
  legacyWorldBuilding: z.string().optional(),
  /** 作者注释：按 noteDepth 深度注入（酒馆 Author's Note 对齐） */
  authorNote: z.string(),
  /** 作者注释注入深度（倒数第 N 条消息处），酒馆默认 4 */
  noteDepth: z.number().int().nonnegative(),
  /** 作品级变量（{{getvar}}/{{setvar}} 作用域，设计 §5.1③）；缺省视为空表 */
  variables: z.record(z.string(), z.string()).optional(),
  /** 快速指令（C 工作台侧栏一键复填的常用指令，作品级）；缺省视为空表 */
  quickDirectives: z.array(z.string()).optional(),
  /** 滚动摘要（防失忆）：前文超出上下文预算的部分被 LLM 压缩后的摘要文本，装配时注入 */
  rollingSummary: z.string().optional(),
  /** 已摘要覆盖的消息条数（增量摘要游标：历史超过此数才需要再次摘要） */
  summaryUpTo: z.number().int().nonnegative().optional(),
  /** chat 模式回复长度档位（短/中/长，缺省视为 medium）；novel 模式不消费此字段 */
  chatReplyLength: ChatReplyLengthSchema.optional(),
  /** novel 模式每章目标字数（缺省视为 3000；兜底主提示词与末尾写作要求注入共用） */
  targetChapterWords: z.number().int().positive().optional(),
  /** 文风画像（文风复刻）：参考文字提炼的纯写法指令，非空时以最高优先级注入设定块 */
  styleGuide: z.string().optional(),
  /** 章节大纲（一键导入大纲）：生成第 N 章时按 index 匹配把本章要点追加进指令；缺省视为无 */
  chapterOutlines: z.array(ChapterOutlineItemSchema).optional(),
  /** 人物状态卡（自动记忆）：AI 每 N 章抽取的动态事实（位置/伤势/持有物/关系），随【作品设定】注入；作者可编辑=最终事实源 */
  characterState: z.string().optional(),
  /** 伏笔登记（自动抽取+人工维护）：plantedAt=埋设章号，resolved=已回收；未回收项注入上下文提醒 */
  foreshadows: z
    .array(
      z.object({
        id: z.string(),
        desc: z.string(),
        plantedAt: z.number().int(),
        resolved: z.boolean().optional(),
      }),
    )
    .optional(),
});
export type NovelSettings = z.infer<typeof NovelSettingsSchema>;

/** 新建作品的设定默认值（移植旧站 defaultSettings） */
export const defaultNovelSettings: NovelSettings = {
  genre: 'chuanyue',
  subGenre: '异世大陆',
  customGenre: '',
  customSubGenre: '',
  backgroundNote: '',
  brotherAge: 22,
  brotherPersonalities: [],
  customBrotherPersonality: '',
  brotherAbility: '',
  sisterAge: 18,
  sisterPersonalities: [],
  customSisterPersonality: '',
  sisterAbility: '',
  relationType: '相互扶持共同成长型',
  customRelationType: '',
  powerSystem: '',
  factions: '',
  coreConflict: '',
  storyTones: ['热血爽文'],
  customStoryTone: '',
  writingStyle: 'default',
  customWritingStyle: '',
  desiredChapterCount: 50,
  outlineChapterCount: 50,
  pastedOutline: '',
  authorNote: '',
  noteDepth: 4,
  targetChapterWords: DEFAULT_TARGET_CHAPTER_WORDS,
};

// ---------- 作品 ----------
export const WorkModeSchema = z.enum(['novel', 'chat']);
export type WorkMode = z.infer<typeof WorkModeSchema>;

export const ViewPreferenceSchema = z.enum(['a', 'b', 'c']);
export type ViewPreference = z.infer<typeof ViewPreferenceSchema>;

/** 书架统计缓存（设计 §4.6）：work.json 内的计数，由消息写入方维护（Task 8） */
export const WorkStatsSchema = z.strictObject({
  /** 消息总条数 */
  messageCount: z.number().int().nonnegative(),
  /** 章节数（novel 模式：带 chapter 元数据的消息数） */
  chapterCount: z.number().int().nonnegative(),
  /** 正文总字数 */
  charCount: z.number().int().nonnegative(),
  /** 已上架章节数（chapter.publishedVersionId 非空；安卓 app 阅读书架判据，旧数据重算前缺省） */
  publishedChapterCount: z.number().int().nonnegative().optional(),
});
export type WorkStats = z.infer<typeof WorkStatsSchema>;

/**
 * 素材绑定记录（安卓 app Phase2，共识 D4 绑定三态）
 *
 * characterIds/worldbookIds/factionIds 保持「初始绑定」（全书生效）语义不变；
 * bindings 管理推进中的增量绑定：
 * - active + fromChapter=N：第 N 章及之后生效（N=1 等价初始绑定）
 * - pending：AI 检出待作者确认（确认 → active + 素材实体入库 + 归属本书）
 * 生成第 C 章时素材生效 = 初始绑定 ids ∪ bindings(active 且 fromChapter≤C)。
 */
export const AssetBindingSchema = z.strictObject({
  assetId: z.string().min(1),
  kind: z.enum(['character', 'worldbook', 'faction']),
  fromChapter: z.number().int().min(1),
  status: z.enum(['active', 'pending']),
  /** 来源备注（如「第3章首次出现（AI 检测）」） */
  note: z.string().optional(),
});
export type AssetBinding = z.infer<typeof AssetBindingSchema>;

export const WorkSchema = z.strictObject({
  id: z.string().min(1),
  /** 乐观版本号：每次写入 +1，PATCH 不匹配返回 409 */
  revision: z.number().int().nonnegative(),
  title: z.string(),
  /** 同一数据结构，语义不同：novel=作者指令驱动，chat=角色扮演 */
  mode: WorkModeSchema,
  /** 题材主题（6 套 + custom，驱动前端主题切换） */
  genre: z.string(),
  characterIds: z.array(z.string()),
  worldbookIds: z.array(z.string()),
  /** 势力介绍绑定（安卓 app Phase2；缺省=旧数据兼容空） */
  factionIds: z.array(z.string()).optional(),
  /** 增量绑定记录（三态：fromChapter 生效章 / pending 待确认；缺省=旧数据无增量绑定） */
  bindings: z.array(AssetBindingSchema).optional(),
  presetId: z.string(),
  regexScriptIds: z.array(z.string()),
  settings: NovelSettingsSchema,
  /** 允许角色卡覆盖预设（§4.4）：缺省视为 true（与酒馆默认一致） */
  allowCardOverride: z.boolean().optional(),
  /** 角色名 → TTS 声音路由 */
  voiceMap: z.record(z.string(), z.string()),
  /** 书架统计缓存：消息写入方维护（updateWorkStats），未写入前缺省 */
  stats: WorkStatsSchema.optional(),
  viewPreference: ViewPreferenceSchema.optional(),
  /** 书架分类标签（安卓 app Phase2；自定义自由文本，缺省=未分类） */
  shelfTag: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Work = z.infer<typeof WorkSchema>;
