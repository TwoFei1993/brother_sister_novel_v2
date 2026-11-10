/**
 * 短剧项目 API（实施计划 T1.5/T2.7）：project 读写 + 生图
 *
 * project.json 与 work.json 独立 revision（同一把 per-work 写锁，server 侧保证）。
 * PATCH 返回更新后的全量 project（revision+1），调用方以此刷新本地状态。
 */
import { apiFetch } from './client';
import type { DuanjuPatch, DuanjuProject, StoredImage } from '@shared/duanju';
import { generateImageOnComfy, loadComfyConfig } from '../features/duanju/lib/comfy';
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
  /** 生图通道（comfy=本地 ComfyUI 免费秒级 / zhipu=GLM-Image 文字强 / seedream=火山 Seedream 质量顶级；缺省按用户设置或 minimax） */
  provider?: 'minimax' | 'zhipu' | 'seedream' | 'comfy';
  /** 分帧号（kind='frame' 必填 1-4） */
  frameIndex?: number;
}

/** 本地 ComfyUI 尺寸档（2026-11-10 实测定稿）：设定图/场景横版、分帧竖屏 */
function comfySizeFor(kind: GenerateImageInput['kind']): { width: number; height: number } {
  return kind === 'frame' ? { width: 768, height: 1344 } : { width: 1344, height: 768 };
}

/**
 * 生图单点收口（5 个调用场景共用）：comfy 通道浏览器直连本地 ComfyUI（免费秒级），
 * 生成 blob 经回流端点归档落库；云端通道走 server API（原路径不动，作降级选项）。
 */
export async function generateDuanjuImage(
  workId: string,
  input: GenerateImageInput,
): Promise<{ image: StoredImage; project: DuanjuProject }> {
  const provider = input.provider ?? useSettingsStore.getState().llmPrefs.imageProvider ?? 'minimax';
  if (provider !== 'comfy') {
    // 云端路径：把有效 provider 显式带给 server（顺带修复场景图缺省漏传 provider 的不一致）
    return apiFetch<{ image: StoredImage; project: DuanjuProject }>(
      `/api/works/${workId}/duanju/images`,
      { method: 'POST', body: JSON.stringify({ ...input, provider }) },
    );
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
  kind: 'character' | 'scene' | 'frame',
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
