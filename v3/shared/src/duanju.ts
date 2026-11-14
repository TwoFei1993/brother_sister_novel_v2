/**
 * 短剧模式数据模型（共识 D1-D10 / 实施计划 T1.1）
 *
 * Work.mode='duanju' 时，全部短剧状态存于 data/works/<id>/duanju/project.json，
 * 与小说章节消息流完全隔离（D2）。生图产物（images/videos）为 server 转存后的
 * 相对路径（duanju/images/xx.png）；MiniMax 原始 URL 仅 24h 有效，不可持久引用。
 */
import { z } from 'zod';

// ---------- 基础件 ----------

const idSchema = z.string().min(1);
/** 实体时间戳（ms）；下游 builtFrom 快照与之比对推导 stale */
const tsSchema = z.number().int().nonnegative();
/** 转存图片记录：path 相对 work 目录（duanju/images/xx.png）；originUrl 仅诊断用（24h 失效） */
export const StoredImageSchema = z.strictObject({
  id: idSchema,
  path: z.string().min(1),
  prompt: z.string(),
  createdAt: tsSchema,
  originUrl: z.string().optional(),
});
export type StoredImage = z.infer<typeof StoredImageSchema>;

// ---------- 剧本（D5：多来源 + 拆解审核卡） ----------

export const DuanjuScriptSchema = z.strictObject({
  /** 剧本来源：ai=工作台 AI 对话 / pasted=粘贴 / manual=手写 */
  source: z.enum(['ai', 'pasted', 'manual']),
  text: z.string(),
  /** 定稿确认门：确认后才解锁角色/场景/分镜 tab */
  confirmed: z.boolean(),
  updatedAt: tsSchema,
});
export type DuanjuScript = z.infer<typeof DuanjuScriptSchema>;

/** 违审替换建议（资料第 7 课）：高风险表达 → 中性可视化描述 */
export const RiskReplacementSchema = z.strictObject({
  id: idSchema,
  original: z.string(),
  replacement: z.string(),
  /** 作者处置：pending 未决 / accepted 已采纳（改剧本时替换）/ dismissed 驳回 */
  status: z.enum(['pending', 'accepted', 'dismissed']).optional(),
});
export type RiskReplacement = z.infer<typeof RiskReplacementSchema>;

/** 拆解审核卡（资料第 2 课）：逐项可编辑，confirmed 全 true 才算审完 */
export const ReviewCardsSchema = z.strictObject({
  summary: z.string(),
  /** 事件链：一行一事件 */
  eventChain: z.array(z.string()),
  conflict: z.string(),
  characterRelations: z.string(),
  /** 情绪点 */
  emotionPoints: z.array(z.string()),
  /** 可视化动作（心理描写 → 可见动作） */
  visualActions: z.array(z.string()),
  riskReplacements: z.array(RiskReplacementSchema),
  /** 各卡确认态（共识：逐项人工确认） */
  confirmed: z.record(z.string(), z.boolean()).optional(),
  updatedAt: tsSchema.optional(),
});
export type ReviewCards = z.infer<typeof ReviewCardsSchema>;

export const EMPTY_REVIEW_CARDS: ReviewCards = {
  summary: '',
  eventChain: [],
  conflict: '',
  characterRelations: '',
  emotionPoints: [],
  visualActions: [],
  riskReplacements: [],
  confirmed: {},
};

// ---------- 角色 / 场景（D6-D7） ----------

export const DuanjuCharacterSchema = z.strictObject({
  id: idSchema,
  /** 允许空名草稿（生图门禁在客户端校验必填） */
  name: z.string(),
  /** 身份/年龄/外观锚点（发色发型瞳色体型服装——一致性的事实源，prompt 组装必注入） */
  profile: z.string(),
  /** 服装库（B5 轻量版）：服装描述清单（AI 生成或手加）；分帧 prompt 注入当前指定款。optional 兼容旧数据/旧客户端 */
  outfits: z.array(z.string()).optional(),
  /** 当前穿着的服装描述（outfits 之一或自由文本；分帧生图时注入） */
  currentOutfit: z.string().optional(),
  /** 服装库白底商品图（AI 批量生成或上传；与 outfits 文本按序对应由用户管理） */
  outfitImages: z.array(StoredImageSchema).optional(),
  /** 连续性锁面（drama-skills 对照 P1-8）：跨镜不变外观的最小英文名词短语，逐字注入帧/视频 prompt——字符串级一致，杜绝 LLM 转述漂移 */
  lockPhrase: z.string().optional(),
  /** 设定图候选（可多张重roll）；主参考图从其中选定 */
  sheetImages: z.array(StoredImageSchema),
  /** 主参考图 id：分帧参考通道 image1（建议指向大头照锚点——脸最稳）；server 读该图转 Data URL */
  refImageId: idSchema.nullable().optional(),
  /** 流水线创建时刻（307e617 起写入；schema 此前未认导致 PATCH 被 strictObject 拒——e2e 实跑暴露） */
  createdAt: tsSchema.optional(),
  updatedAt: tsSchema,
});
export type DuanjuCharacter = z.infer<typeof DuanjuCharacterSchema>;

export const DuanjuSceneSchema = z.strictObject({
  id: idSchema,
  /** 允许空名草稿（生图门禁在客户端校验必填） */
  name: z.string(),
  /** 空间结构/光影基调/关键道具/色彩（资料第 4 课）；含固定地标与屏幕相对位置（分镜锚定） */
  spec: z.string(),
  /** 空间模式（B 场景升级）：interior-depth/lateral-run/one-side-depth/landmark-far/vertical-tower/nature-frame/enclosed */
  mode: z.string().optional(),
  images: z.array(StoredImageSchema),
  /** 流水线创建时刻（同 character 的 createdAt 补丁） */
  createdAt: tsSchema.optional(),
  updatedAt: tsSchema,
});
export type DuanjuScene = z.infer<typeof DuanjuSceneSchema>;

/** 生图记账（成本仪表盘事实源）：server 持锁追加，PATCH 白名单不含（客户端只读） */
export const SpendEntrySchema = z.strictObject({
  ts: tsSchema,
  kind: z.enum(['character', 'outfit', 'scene', 'shot', 'frame']),
  refId: idSchema,
  /** 附加定位（frame 为 frame-N；shot 整图旧模式无） */
  note: z.string().optional(),
});
export type SpendEntry = z.infer<typeof SpendEntrySchema>;

// ---------- 集 / 镜头（成本优化：分帧模式，gridImage 兼容旧整图） ----------

export const DuanjuEpisodeSchema = z.strictObject({
  id: idSchema,
  /** 集号（从 1 起） */
  index: z.number().int().positive(),
  title: z.string(),
  synopsis: z.string(),
});
export type DuanjuEpisode = z.infer<typeof DuanjuEpisodeSchema>;

/** 生成依据快照（server 生图时写入真实时点）：与 script/characters/scenes 当前 updatedAt 逐项比对推导 stale */
export const BuiltFromSchema = z.strictObject({
  scriptAt: tsSchema.optional(),
  /** characterId → 该角色当时的 updatedAt */
  charAt: z.record(z.string(), tsSchema).optional(),
  /** sceneId → 该场景当时的 updatedAt */
  sceneAt: z.record(z.string(), tsSchema).optional(),
});
export type BuiltFrom = z.infer<typeof BuiltFromSchema>;

/** 分帧产物：index 1-4 对应 gridParts 顺位；rolls = 该帧累计重roll 次数（成本统计） */
export const ShotFrameSchema = z.strictObject({
  index: z.number().int().min(1).max(4),
  image: StoredImageSchema,
  rolls: z.number().int().nonnegative().default(0),
});
export type ShotFrame = z.infer<typeof ShotFrameSchema>;

export const DuanjuShotSchema = z.strictObject({
  id: idSchema,
  episodeId: idSchema,
  /** 镜头号（集内从 1 起） */
  index: z.number().int().positive(),
  /** 景别（远景/全景/中景/近景/特写） */
  shotSize: z.string(),
  /** 运镜（固定/推/拉/摇/移/跟） */
  cameraMove: z.string(),
  /** 动作起点 → 终点（资料第 5 课：动作起终点是钉点） */
  actionStart: z.string(),
  actionEnd: z.string(),
  /** 人物站位 */
  staging: z.string(),
  dialog: z.string(),
  /** 台词说话人（drama-skills P0-3：H3 说话人绑定 (S1) 的数据源；缺省回退出场首角色名） */
  speaker: z.string().optional(),
  /** 画内文字（drama-skills P1-10）：手机屏幕/招牌/纸条等须逐字可读的画内内容——帧 prompt 逐字渲染 + 视频 prompt 文字边界例外声明 */
  onScreenText: z.string().optional(),
  /** 四格画面描述（分帧 prompt 的数据源；AI 拆镜头写入，可编辑改写后重roll） */
  gridParts: z.array(z.string()).max(4).default([]),
  /** 段末状态（A5）：本镜最后一帧画面（谁+在哪+姿态+道具状态）——跨镜衔接锚点，喂给下镜 prompt */
  endState: z.string().optional(),
  /** 钩子类型（B1，受控词表）：reveal 揭示 / reversal 反转 / callback 回收 / suspense 悬念 /
   *  chase 追逐 / visual-joke 视觉笑点 / tender 情感 / expression-beat 表情节拍；密度自检：每 3 镜至少 1 个强钩子 */
  hookType: z.string().optional(),
  /** 旧整图 prompt（兼容 D7 时期数据；新流程走 gridParts + buildFramePrompt） */
  gridPrompt: z.string(),
  /** 预估时长秒（AI 拆镜头输出或手填；剧本导出时间轴 = 前序镜头累加） */
  durationSec: z.number().int().positive().max(120).optional(),
  /** 分帧产物（成本优化核心：单帧重roll 只花 1 张钱） */
  frames: z.array(ShotFrameSchema).default([]),
  /** 四宫格整图（D7 旧模式产物；保留展示兼容，新生成不再写入） */
  gridImage: StoredImageSchema.optional(),
  /** 成品视频（即梦生成后上传归档，D10） */
  finalVideo: z
    .strictObject({ path: z.string(), uploadedAt: tsSchema })
    .optional(),
  /** 本镜头出场角色 id */
  characterIds: z.array(z.string()).default([]),
  /** 本镜头场景 id */
  sceneId: idSchema.nullable().optional(),
  builtFrom: BuiltFromSchema.optional(),
  updatedAt: tsSchema,
});
export type DuanjuShot = z.infer<typeof DuanjuShotSchema>;

// ---------- 项目根（project.json 全量） ----------

/** 新建短剧的可选项（createWork 入参；服务端原子初始化 project.json） */
export const DuanjuInitSchema = z.strictObject({
  /** 目标集数（默认 12，共识「六、默认值」） */
  targetEpisodes: z.number().int().positive().max(200).default(12),
  /** 画风（默认 动漫风；全局可改） */
  style: z.string().min(1).default('动漫风'),
  /** 主角设定自由文本（人数/身份/关系/外形；题材中立 D9） */
  protagonists: z.string().default(''),
});
export type DuanjuInit = z.infer<typeof DuanjuInitSchema>;

export const DuanjuProjectSchema = z.strictObject({
  /** 乐观版本号：每次 PATCH +1，不匹配返回 409（与 work.json 同语义、独立计数） */
  revision: z.number().int().positive(),
  script: DuanjuScriptSchema,
  reviewCards: ReviewCardsSchema,
  style: z.string().min(1),
  /** 项目风格签名固定串（B3 视觉词汇表轻量版）：逐字注入每帧/每镜 prompt 尾部，不重写；空=不注入 */
  visualSignature: z.string().optional(),
  targetEpisodes: z.number().int().positive(),
  protagonists: z.string(),
  characters: z.array(DuanjuCharacterSchema),
  scenes: z.array(DuanjuSceneSchema),
  episodes: z.array(DuanjuEpisodeSchema),
  shots: z.array(DuanjuShotSchema),
  /** 生图记账（server 追加，cap 5000；旧数据无此字段 → 代码侧 ?? [] 防御） */
  spendLog: z.array(SpendEntrySchema).default([]),
  createdAt: tsSchema,
  updatedAt: tsSchema,
});
export type DuanjuProject = z.infer<typeof DuanjuProjectSchema>;

/** 新建作品的初始 project（server createWork duanju 分支使用） */
export function newDuanjuProject(init: DuanjuInit, now: number): DuanjuProject {
  return {
    revision: 1,
    script: { source: 'manual', text: '', confirmed: false, updatedAt: now },
    reviewCards: EMPTY_REVIEW_CARDS,
    style: init.style,
    targetEpisodes: init.targetEpisodes,
    protagonists: init.protagonists,
    characters: [],
    scenes: [],
    episodes: [],
    shots: [],
    spendLog: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** PATCH 白名单：客户端可改字段（revision 服务端管理） */
export const DuanjuPatchSchema = z.strictObject({
  revision: z.number().int().positive(),
  script: DuanjuScriptSchema.optional(),
  reviewCards: ReviewCardsSchema.optional(),
  style: z.string().min(1).optional(),
  visualSignature: z.string().optional(),
  targetEpisodes: z.number().int().positive().max(200).optional(),
  protagonists: z.string().optional(),
  characters: z.array(DuanjuCharacterSchema).optional(),
  scenes: z.array(DuanjuSceneSchema).optional(),
  episodes: z.array(DuanjuEpisodeSchema).optional(),
  shots: z.array(DuanjuShotSchema).optional(),
});
export type DuanjuPatch = z.infer<typeof DuanjuPatchSchema>;
