/**
 * 短剧项目 API（实施计划 T1.5/T2.7）：project 读写 + 生图
 *
 * project.json 与 work.json 独立 revision（同一把 per-work 写锁，server 侧保证）。
 * PATCH 返回更新后的全量 project（revision+1），调用方以此刷新本地状态。
 */
import { apiFetch } from './client';
import type { DuanjuPatch, DuanjuProject, StoredImage } from '@shared/duanju';

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
  kind: 'character' | 'scene' | 'shot';
  refId: string;
  prompt: string;
  aspectRatio?: string;
  /** 角色参考图 id（保持人物一致；缺省用角色当前主参考图） */
  refImageId?: string;
  /** 生图通道（zhipu=GLM-Image 文字渲染强；缺省按用户设置或 minimax） */
  provider?: 'minimax' | 'zhipu';
}

export async function generateDuanjuImage(
  workId: string,
  input: GenerateImageInput,
): Promise<{ image: StoredImage; project: DuanjuProject }> {
  return apiFetch<{ image: StoredImage; project: DuanjuProject }>(
    `/api/works/${workId}/duanju/images`,
    { method: 'POST', body: JSON.stringify(input) },
  );
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
