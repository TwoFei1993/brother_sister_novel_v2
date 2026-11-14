/**
 * 短剧项目 API（实施计划 T1.5/T2.7）：project 读写 + 生图
 *
 * project.json 与 work.json 独立 revision（同一把 per-work 写锁，server 侧保证）。
 * PATCH 返回更新后的全量 project（revision+1），调用方以此刷新本地状态。
 */
import { apiFetch } from './client';
import type { DuanjuPatch, DuanjuProject, StoredImage } from '@shared/duanju';
import { generateImageOnComfy, loadComfyConfig } from '../features/duanju/lib/comfy';
import { composeCharacterSheet, cropFrontView } from '../features/duanju/lib/comfyCompose';
import { characterSheetSplitPrompts } from '../features/duanju/lib/prompts/prompts-image';
import { useSettingsStore } from '../stores/settings';

export async function getDuanjuProject(workId: string): Promise<DuanjuProject> {
  return apiFetch<DuanjuProject>(`/api/works/${workId}/duanju`);
}

export async function patchDuanjuProject(workId: string, patch: DuanjuPatch): Promise<DuanjuProject> {
  return apiFetch<DuanjuProject>(`/api/works/${workId}/duanju`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** 便捷：读取当前 revision 后提交局部字段（409 由调用方处理提示刷新） */
export async function patchDuanju(
  workId: string,
  revision: number,
  fields: Partial<Omit<DuanjuPatch, 'revision'>>,
): Promise<DuanjuProject> {
  return patchDuanjuProject(workId, { revision, ...fields });
}

// ---------- 生图（Phase 2，共识 D1/D6） ----------

export interface GenerateImageInput {
  kind: 'character' | 'outfit' | 'scene' | 'shot' | 'frame';
  refId: string;
  prompt: string;
  aspectRatio?: string;
  /** 角色参考图 id（保持人物一致；缺省用角色当前主参考图） */
  refImageId?: string;
  /** 生图通道（comfy=本地 ComfyUI 免费秒级 / zhipu=GLM-Image 文字强 / seedream=火山 Seedream 质量顶级；缺省按用户设置或 comfy） */
  provider?: 'zhipu' | 'seedream' | 'comfy';
  /** 分帧号（kind='frame' 必填 1-4） */
  frameIndex?: number;
  /** 设定图双段合成的原始数据（仅 comfy 通道用；云端 schema strictObject 会拒，透传前剥离） */
  sheetSplit?: { style: string; name: string; profile: string };
  /** 角色定妆照路径（分镜参考生图通道用：comfy+frame 时走 Qwen-Image-Edit-2511 参考图编辑） */
  refImagePath?: string;
  /** 正面全身单图路径（三参考档 image2——锁身体/服装；角色无此图时自动回退双参考） */
  bodyRefPath?: string;
  /** 场景图路径（分镜参考通道 image2：镜头关联场景的最新场景图，跨帧场景一致） */
  sceneRefPath?: string;
}

/**
 * 生图通道读取 helper：store 的 imageProvider 保留 minimax（旧存储兼容），
 * 对外统一收敛为三通道（minimax 通道已移除——按迁移语义落到 comfy）。
 */
export function imageProviderForApi(): GenerateImageInput['provider'] {
  const p = useSettingsStore.getState().llmPrefs.imageProvider;
  if (p === 'zhipu' || p === 'seedream' || p === 'comfy') return p;
  return 'comfy';
}

/** 本地 ComfyUI 尺寸档（2026-11-10 实测定稿）：设定图/场景横版、分帧竖屏；
 *  大头照锚点 4:5 竖版 1152×1440（32 对齐）——单视图不触发 2×2 铺排先验 */
/** P2-12：upload 端点 kind 枚举不含 'shot'（旧整图模式）——收窄并给人话报错 */
function assertUploadKind(kind: GenerateImageInput['kind']): 'character' | 'outfit' | 'scene' | 'frame' {
  if (kind === 'shot') throw new Error('旧整图模式已由分帧替代——分镜请按帧生成');
  return kind;
}

function comfySizeFor(kind: GenerateImageInput['kind'], aspectRatio?: string): { width: number; height: number } {
  if (aspectRatio === '4:5') return { width: 1152, height: 1440 };
  if (kind === 'outfit') return { width: 1024, height: 1024 }; // 白底商品图方图
  return kind === 'frame' ? { width: 768, height: 1344 } : { width: 1344, height: 768 };
}

/**
 * 分镜帧参考生图（Qwen-Image-Edit-2511 双参考）：定妆照注入 <<REF>>（image1 锁角色）
 * + 场景图注入 <<SCENE_REF>>（image2 锁场景）+ 分镜指令 <<PROMPT>> → Lightning 4 步出图。
 */
async function generateFrameWithRef(
  workId: string,
  input: GenerateImageInput,
  genHint?: unknown,
): Promise<{ image: StoredImage; project: DuanjuProject }> {
  const cfg = loadComfyConfig();
  if (!cfg.url.trim()) throw new Error('本地 ComfyUI 未配置地址——请到设置页「本地引擎」填写并保存');
  // 定妆照：server 产物经同源 fetch 取 blob → 上传 ComfyUI input 目录
  const refRes = await fetch(duanjuFileUrl(workId, input.refImagePath!));
  if (!refRes.ok) throw new Error(`定妆照读取失败（HTTP ${refRes.status}）——角色需先生成设定图`);
  const refBlob = await refRes.blob();
  // 场景图（可选）：镜头关联场景有图则注入（双参考档 image2 / 三参考档 image3）
  let sceneRefBlob: Blob | undefined;
  if (input.sceneRefPath) {
    const sceneRes = await fetch(duanjuFileUrl(workId, input.sceneRefPath));
    if (sceneRes.ok) sceneRefBlob = await sceneRes.blob();
  }
  // 正面全身单图（可选，三参考档）：有则 image2 锁身体/服装——身份+身体+场景三重锁定
  let bodyRefBlob: Blob | undefined;
  if (input.bodyRefPath) {
    const bodyRes = await fetch(duanjuFileUrl(workId, input.bodyRefPath));
    if (bodyRes.ok) bodyRefBlob = await bodyRes.blob();
  }
  const blob = await generateImageOnComfy(cfg, {
    prompt: input.prompt,
    width: 0,
    height: 0,
    seed: Math.floor(Math.random() * 2_147_483_647),
    refBlob,
    bodyRefBlob,
    sceneRefBlob,
    workflow: 'qwen-edit-2511',
  });
  const file = new File([blob], 'comfy-frame.png', { type: blob.type || 'image/png' });
  return uploadDuanjuImageFile(workId, assertUploadKind(input.kind), input.refId, file, {
    frameIndex: input.frameIndex,
    prompt: input.prompt,
    source: 'comfy',
    builtFromHint: genHint,
  });
}

/**
 * 设定图双段生成（版式硬规定 v3 + 参考图修正）：三视图 1344×1024 + 头像特写 704×1024
 * → 版式合成图 2048×1024（人看）+ **特写单图单独归档并设为主参考**（AI 参考用——
 * 2511 参考生图的定妆照必须是单主体干净图；版式拼图（多只猫/多人）会让参考通道理解混乱跨帧漂移）。
 */
async function generateCharacterSheetLocal(
  workId: string,
  input: GenerateImageInput,
  genHint?: unknown,
): Promise<{ image: StoredImage; project: DuanjuProject }> {
  const cfg = loadComfyConfig();
  if (!cfg.url.trim()) throw new Error('本地 ComfyUI 未配置地址——请到设置页「本地引擎」填写并保存');
  const split = input.sheetSplit;
  if (!split) throw new Error('设定图双段生成缺少角色数据（style/name/profile）');
  const { portrait, triView } = characterSheetSplitPrompts(split.style, split.name, split.profile);
  const seed = () => Math.floor(Math.random() * 2_147_483_647);
  const [portraitBlob, triViewBlob] = await Promise.all([
    generateImageOnComfy(cfg, { prompt: portrait, width: 704, height: 1024, seed: seed() }),
    generateImageOnComfy(cfg, { prompt: triView, width: 1344, height: 1024, seed: seed() }),
  ]);
  // ① 特写单图先归档（单主体干净图——分镜参考通道的定妆照）
  const upKind = assertUploadKind(input.kind);
  const portraitFile = new File([portraitBlob], 'comfy-portrait.png', { type: 'image/png' });
  const { image: portraitImg, project: afterPortrait } = await uploadDuanjuImageFile(
    workId,
    upKind,
    input.refId,
    portraitFile,
    { prompt: input.prompt, source: 'comfy', builtFromHint: genHint },
  );
  // ② 版式合成图随后归档（人看的完整设定图）
  const blob = await composeCharacterSheet(portraitBlob, triViewBlob);
  const file = new File([blob], 'comfy-sheet.png', { type: 'image/png' });
  const { project: afterSheet } = await uploadDuanjuImageFile(workId, upKind, input.refId, file, {
    prompt: input.prompt,
    source: 'comfy',
    builtFromHint: genHint,
  });
  // ②' 正面全身单图归档（2511 三参考档 image2——锁身体/服装；裁自三视图原图中间格，零生成成本）
  //     prompt 带【正面全身】前缀供 frameBodyRefImage 识别
  try {
    const frontBlob = await cropFrontView(triViewBlob);
    const frontFile = new File([frontBlob], 'comfy-front.png', { type: 'image/png' });
    await uploadDuanjuImageFile(workId, upKind, input.refId, frontFile, {
      prompt: `【正面全身】${input.prompt}`,
      source: 'comfy',
      builtFromHint: genHint,
    });
  } catch {
    /* 裁剪失败不阻塞设定图产出——分镜回退双参考 */
  }
  // ③ 主参考显式指向特写单图（server 首图逻辑只在 refImageId 为空时生效，覆盖不了存量）
  const cur = afterSheet;
  const characters = cur.characters.map((c) =>
    c.id === input.refId ? { ...c, refImageId: portraitImg.id } : c,
  );
  const project = await patchDuanjuProject(workId, { revision: cur.revision, characters });
  return { image: portraitImg, project };
}

/**
 * 生图单点收口（5 个调用场景共用）：comfy 通道浏览器直连本地 ComfyUI（免费秒级），
 * 生成 blob 经回流端点归档落库；云端通道走 server API（原路径不动，作降级选项）。
 */

/** P2 修复：发起生成时（浏览器侧）的上游态快照 hint——动态 import 防循环依赖 */
async function upstreamHintAtStart(shotId?: string): Promise<unknown> {
  if (!shotId) return undefined;
  const { useDuanjuStore } = await import('../features/duanju/store');
  const p = useDuanjuStore.getState().project;
  if (!p) return undefined;
  const shot = p.shots.find((sh) => sh.id === shotId);
  if (!shot) return undefined;
  return {
    scriptAt: p.script.updatedAt,
    charAt: Object.fromEntries(
      shot.characterIds
        .map((cid) => {
          const c = p.characters.find((x) => x.id === cid);
          return c ? [cid, c.updatedAt] : null;
        })
        .filter((e): e is [string, number] => e !== null),
    ),
    sceneAt: shot.sceneId
      ? { [shot.sceneId]: p.scenes.find((x) => x.id === shot.sceneId)?.updatedAt ?? 0 }
      : {},
  };
}

export async function generateDuanjuImage(
  workId: string,
  input: GenerateImageInput,
): Promise<{ image: StoredImage; project: DuanjuProject }> {
  const provider = input.provider ?? useSettingsStore.getState().llmPrefs.imageProvider ?? 'comfy';
  // 生成前一次性取上游态（本函数所有生成路径共用；comfy 分流的上传带回、server 端写入帧级快照）
  const genHint = await upstreamHintAtStart(input.refId);
  if (provider !== 'comfy') {
    // 云端路径：把有效 provider 显式带给 server；本地专用字段 strictObject 前剥离
    const { sheetSplit: _split, refImagePath: _ref, sceneRefPath: _sceneRef, ...cloudInput } = input;
    return apiFetch<{ image: StoredImage; project: DuanjuProject }>(
      `/api/works/${workId}/duanju/images`,
      { method: 'POST', body: JSON.stringify({ ...cloudInput, provider }) },
    );
  }
  if (input.kind === 'character' && input.sheetSplit) {
    return generateCharacterSheetLocal(workId, input, genHint);
  }
  if (input.kind === 'frame' && input.refImagePath) {
    return generateFrameWithRef(workId, input, genHint);
  }
  const cfg = loadComfyConfig();
  if (!cfg.url.trim()) throw new Error('本地 ComfyUI 未配置地址——请到设置页「本地引擎」填写并保存');
  const { width, height } = comfySizeFor(input.kind, input.aspectRatio);
  const blob = await generateImageOnComfy(cfg, {
    prompt: input.prompt,
    width,
    height,
    seed: Math.floor(Math.random() * 2_147_483_647),
  });
  const file = new File([blob], 'comfy.png', { type: blob.type || 'image/png' });
  return uploadDuanjuImageFile(workId, assertUploadKind(input.kind), input.refId, file, {
    frameIndex: input.frameIndex,
    prompt: input.prompt,
    source: 'comfy',
    builtFromHint: genHint,
  });
}

/** 转存产物访问地址（GET 路由带 cookie 鉴权；<img> 直接可用——同源携带） */
export function duanjuFileUrl(workId: string, path: string): string {
  // path 形如 duanju/images/xx.png → 取文件名段
  const name = path.split('/').pop() ?? '';
  return `/api/works/${workId}/duanju/files/${name}`;
}

// ---------- 成品视频回传（Phase 4，共识 D10） ----------

export async function uploadDuanjuVideo(
  workId: string,
  shotId: string,
  file: File,
): Promise<DuanjuProject> {
  const form = new FormData();
  form.append('shotId', shotId);
  form.append('file', file);
  const r = await apiFetch<{ project: DuanjuProject }>(`/api/works/${workId}/duanju/videos`, {
    method: 'POST',
    body: form,
  });
  return r.project;
}

/** 外部生图回流（豆包/即梦 web 免费生成后上传归档为设定图/场景图；亦承接本地 ComfyUI 产物归档） */
export async function uploadDuanjuImageFile(
  workId: string,
  kind: 'character' | 'outfit' | 'scene' | 'frame',  // P2：与 server upload 枚举对齐（'shot' 仅 generate 端点的旧整图模式）
  refId: string,
  file: File,
  opts?: { frameIndex?: number; prompt?: string; source?: 'comfy'; builtFromHint?: unknown },
): Promise<{ image: StoredImage; project: DuanjuProject }> {
  const form = new FormData();
  form.append('kind', kind);
  // P2 修复：comfy 通道生成在浏览器进行——随上传带回「发起生成时」的上游态（生成期间上游变更不再被洗白）
  if (opts?.builtFromHint) form.append('builtFromHint', JSON.stringify(opts.builtFromHint));
  form.append('refId', refId);
  form.append('file', file);
  if (opts?.frameIndex) form.append('frameIndex', String(opts.frameIndex));
  if (opts?.prompt) form.append('prompt', opts.prompt);
  if (opts?.source) form.append('source', opts.source);
  return apiFetch<{ image: StoredImage; project: DuanjuProject }>(
    `/api/works/${workId}/duanju/images/upload`,
    { method: 'POST', body: form },
  );
}
