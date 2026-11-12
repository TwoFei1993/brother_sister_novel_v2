/**
 * 短剧项目 API（实施计划 T1.5/T2.7）：project 读写 + 生图
 *
 * project.json 与 work.json 独立 revision（同一把 per-work 写锁，server 侧保证）。
 * PATCH 返回更新后的全量 project（revision+1），调用方以此刷新本地状态。
 */
import { apiFetch } from './client';
import type { DuanjuPatch, DuanjuProject, StoredImage } from '@shared/duanju';
import { generateImageOnComfy, loadComfyConfig } from '../features/duanju/lib/comfy';
import { composeCharacterSheet } from '../features/duanju/lib/comfyCompose';
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
  kind: 'character' | 'scene' | 'shot' | 'frame';
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

/** 本地 ComfyUI 尺寸档（2026-11-10 实测定稿）：设定图/场景横版、分帧竖屏 */
function comfySizeFor(kind: GenerateImageInput['kind']): { width: number; height: number } {
  return kind === 'frame' ? { width: 768, height: 1344 } : { width: 1344, height: 768 };
}

/**
 * 设定图双段生成 + 合成（版式硬规定 v2·零压缩）：三视图 1344×768 + 头像特写 448×768
 * 各自高遵循任务 → canvas 合成 1792×768，两段原尺寸落位（v1 压缩问题已修）。
 */
async function generateCharacterSheetLocal(
  workId: string,
  input: GenerateImageInput,
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
  const blob = await composeCharacterSheet(portraitBlob, triViewBlob);
  const file = new File([blob], 'comfy-sheet.png', { type: 'image/png' });
  return uploadDuanjuImageFile(workId, input.kind, input.refId, file, {
    prompt: input.prompt,
    source: 'comfy',
  });
}

/**
 * 生图单点收口（5 个调用场景共用）：comfy 通道浏览器直连本地 ComfyUI（免费秒级），
 * 生成 blob 经回流端点归档落库；云端通道走 server API（原路径不动，作降级选项）。
 */
export async function generateDuanjuImage(
  workId: string,
  input: GenerateImageInput,
): Promise<{ image: StoredImage; project: DuanjuProject }> {
  const provider = input.provider ?? useSettingsStore.getState().llmPrefs.imageProvider ?? 'comfy';
  if (provider !== 'comfy') {
    // 云端路径：把有效 provider 显式带给 server；sheetSplit 仅本地合成用，strictObject 前剥离
    const { sheetSplit: _split, ...cloudInput } = input;
    return apiFetch<{ image: StoredImage; project: DuanjuProject }>(
      `/api/works/${workId}/duanju/images`,
      { method: 'POST', body: JSON.stringify({ ...cloudInput, provider }) },
    );
  }
  if (input.kind === 'character' && input.sheetSplit) {
    return generateCharacterSheetLocal(workId, input);
  }
  const cfg = loadComfyConfig();
  if (!cfg.url.trim()) throw new Error('本地 ComfyUI 未配置地址——请到设置页「本地引擎」填写并保存');
  const { width, height } = comfySizeFor(input.kind);
  const blob = await generateImageOnComfy(cfg, {
    prompt: input.prompt,
    width,
    height,
    seed: Math.floor(Math.random() * 2_147_483_647),
  });
  const file = new File([blob], 'comfy.png', { type: blob.type || 'image/png' });
  return uploadDuanjuImageFile(workId, input.kind, input.refId, file, {
    frameIndex: input.frameIndex,
    prompt: input.prompt,
    source: 'comfy',
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
  kind: 'character' | 'scene' | 'shot' | 'frame',
  refId: string,
  file: File,
  opts?: { frameIndex?: number; prompt?: string; source?: 'comfy' },
): Promise<{ image: StoredImage; project: DuanjuProject }> {
  const form = new FormData();
  form.append('kind', kind);
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
