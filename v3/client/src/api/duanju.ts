/**
 * 短剧项目 API（实施计划 T1.5）：GET / PATCH /api/works/:id/duanju
 *
 * project.json 与 work.json 独立 revision（同一把 per-work 写锁，server 侧保证）。
 * PATCH 返回更新后的全量 project（revision+1），调用方以此刷新本地状态。
 */
import { apiFetch } from './client';
import type { DuanjuPatch, DuanjuProject } from '@shared/duanju';

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
