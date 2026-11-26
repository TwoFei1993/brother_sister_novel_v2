/**
 * 短剧试验台数据模型（设计共识 2026-11-26 第 2 节；M2 增强：参考图 / 带入设定）。
 *
 * 记录存 data/works/<id>/duanju/lab.json（与 project.json 分离：不参与乐观锁、不撑大它）；
 * 图片落 duanju/images/，访问复用现有文件流路由。
 */
import { z } from 'zod';

import { StoredImageSchema, idSchema, tsSchema } from '../duanju';

/** 生图通道（与设置页的三通道一致；comfy=本地 ComfyUI 浏览器直连） */
export const LAB_PROVIDERS = ['comfy', 'seedream', 'zhipu'] as const;
export const LabProviderSchema = z.enum(LAB_PROVIDERS);
export type LabProvider = z.infer<typeof LabProviderSchema>;

/** 画幅（云端通道的尺寸表没有 4:5，界面层按通道隐藏） */
export const LAB_ASPECTS = ['9:16', '16:9', '1:1', '4:5'] as const;
export const LabAspectSchema = z.enum(LAB_ASPECTS);
export type LabAspect = z.infer<typeof LabAspectSchema>;

/** 画面类型（决定扩写模板） */
export const LAB_KINDS = ['free', 'character', 'scene', 'frame'] as const;
export const LabKindSchema = z.enum(LAB_KINDS);
export type LabKind = z.infer<typeof LabKindSchema>;

/** 各通道的提示词长度上限（超出时界面禁止出图并提示删减，不截断——审批的就是送去生成的） */
export const LAB_PROMPT_LIMITS: Record<LabProvider, number> = {
  comfy: 3000,
  seedream: 2000,
  zhipu: 1000,
};

/** 各通道的参考图上限（H3-Image 的 conditioning 有多个参考槽；Seedream 的 image 字段收 1 张；GLM-Image 没有参考图参数） */
export const LAB_REF_LIMITS: Record<LabProvider, number> = { comfy: 3, seedream: 1, zhipu: 0 };

/** 单张参考图的大小上限（界面与服务端都按它拦） */
export const LAB_REF_MAX_BYTES = 10 * 1024 * 1024;

/**
 * 参考图：work 内相对路径 + 一句说明。路径只认试验台上传时生成的文件名（labref-<uuid>.png|jpg）——
 * 服务端据此读盘传给上游，前缀白名单即防目录穿越。
 */
export const LAB_REF_PATH_RE = /^duanju\/images\/labref-[a-f0-9-]{8,}\.(png|jpg)$/;
export const LabRefSchema = z.strictObject({
  path: z.string().regex(LAB_REF_PATH_RE, '参考图路径不合法（请重新上传）'),
  /** 这张图画的是什么（扩写模型看不到图，按 Picture 序号照这句写） */
  caption: z.string().max(200),
});
export type LabRef = z.infer<typeof LabRefSchema>;

/** 云端通道（本地通道是浏览器直连引擎，不走服务端） */
export const CLOUD_IMAGE_PROVIDERS = ['seedream', 'zhipu'] as const;
export type CloudImageProvider = (typeof CLOUD_IMAGE_PROVIDERS)[number];

/**
 * 云端通道尺寸表（"宽x高" 像素串，沿用各通道官方推荐尺寸）：服务端 services/image.ts 的尺寸映射与
 * 试验台界面都以此为准——改这里一处即可，两处自动同步。
 */
export const CLOUD_IMAGE_SIZES = {
  seedream: {
    '1:1': '2048x2048',
    '3:4': '1536x2048',
    '4:3': '2048x1536',
    '16:9': '2560x1440',
    '9:16': '1440x2560',
    '2:3': '1360x2048',
    '3:2': '2040x1360',
  },
  zhipu: {
    '1:1': '1024x1024',
    '3:4': '864x1152',
    '4:3': '1152x864',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '2:3': '832x1248',
    '3:2': '1248x832',
  },
} as const;

/** 云端通道尺寸兜底（比例不在表里时服务端使用） */
export const CLOUD_IMAGE_SIZE_FALLBACK: Record<CloudImageProvider, string> = {
  seedream: '1536x2048',
  zhipu: '864x1152',
};

export const LabRecordSchema = z.strictObject({
  id: idSchema,
  createdAt: tsSchema,
  /** 用户输入的简短提示词 */
  brief: z.string().min(1).max(300),
  /** 审批后实际送生成的完整提示词 */
  prompt: z.string().min(1).max(4000),
  kind: LabKindSchema,
  provider: LabProviderSchema,
  aspect: LabAspectSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** 随机种子（本地通道可复现；云端通道不可指定，记 0） */
  seed: tsSchema,
  /** 参考图（按 Picture 序号；第 1 张是底图） */
  refs: z.array(LabRefSchema).max(3),
  /** 扩写时带入的本作品角色 / 场景 id */
  characterIds: z.array(idSchema),
  sceneIds: z.array(idSchema),
  /** 产物 */
  image: StoredImageSchema,
  elapsedSec: z.number().int().nonnegative(),
});
export type LabRecord = z.infer<typeof LabRecordSchema>;

/** lab.json 全量 */
export const LabFileSchema = z.strictObject({ records: z.array(LabRecordSchema) });
export type LabFile = z.infer<typeof LabFileSchema>;

/** 历史记录保留上限：超出时淘汰最旧的 */
export const LAB_RECORDS_MAX = 300;

// ---------- 请求体契约（服务端校验与客户端类型同源） ----------

const idsSchema = z.array(idSchema);
const metaBase = {
  brief: z.string().min(1).max(300),
  prompt: z.string().min(1).max(4000),
  kind: LabKindSchema,
  aspect: LabAspectSchema,
  /** 宽高由客户端按通道尺寸表给出（界面显示与归档用；云端实际尺寸由上游按比例决定） */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** 扩写时带入的本作品角色 / 场景 id */
  characterIds: idsSchema,
  sceneIds: idsSchema,
  /** 参考图（界面已按通道上限截取；服务端再按通道兜底） */
  refs: z.array(LabRefSchema).max(3),
};

/** POST /works/:id/duanju/lab/generate 的请求体（云端通道） */
export const LabGenerateBodySchema = z.strictObject({
  ...metaBase,
  provider: z.enum(CLOUD_IMAGE_PROVIDERS),
});
export type LabGenerateBody = z.infer<typeof LabGenerateBodySchema>;

/** POST /works/:id/duanju/lab/images 的 meta 字段（本地通道产物回流） */
export const LabUploadMetaSchema = z.strictObject({
  ...metaBase,
  provider: z.literal('comfy'),
  seed: tsSchema,
  /** 客户端计的生成耗时（浏览器直连引擎，服务端无从得知） */
  elapsedSec: z.number().int().nonnegative().max(86_400),
});
export type LabUploadMeta = z.infer<typeof LabUploadMetaSchema>;

/** POST /works/:id/duanju/lab/refs 的响应（参考图上传后拿到可写进记录的路径） */
export const LabRefUploadedSchema = z.strictObject({ path: z.string().regex(LAB_REF_PATH_RE) });
export type LabRefUploaded = z.infer<typeof LabRefUploadedSchema>;

/**
 * 本地出图的在途检查点（客户端存 localStorage）：归档字段 + 引擎任务号，提交成功即写、归档后清。
 * 定义在这里而不是客户端：客户端包不依赖 zod，校验 schema 统一放 shared。
 */
export const LabTaskCheckpointSchema = LabUploadMetaSchema.omit({ elapsedSec: true }).extend({
  base: z.string(),
  promptId: z.string().min(1),
  startedAt: tsSchema,
});
export type LabTaskCheckpoint = z.infer<typeof LabTaskCheckpointSchema>;

/** 一次试验的输入参数（客户端输入区的状态；也是扩写在途时的快照） */
export const LabInputSchema = z.strictObject({
  brief: z.string().max(300),
  kind: LabKindSchema,
  aspect: LabAspectSchema,
  language: z.enum(['zh', 'en']),
  provider: LabProviderSchema,
  /** 带入扩写的本作品角色 / 场景 id */
  characterIds: z.array(idSchema),
  sceneIds: z.array(idSchema),
  /** 参考图（按顺序；第 1 张是底图） */
  refs: z.array(LabRefSchema),
});
export type LabInput = z.infer<typeof LabInputSchema>;

export const EMPTY_LAB_FILE: LabFile = { records: [] };
