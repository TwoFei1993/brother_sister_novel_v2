/**
 * 作品 API 封装（设计 §6 /api/works）：书架与写作台共用
 *
 * - list：GET /api/works 浅列表（书架卡片所需字段，按最近更新排序；无 revision/createdAt）
 * - get：GET /api/works/:id 全量 Work（PATCH 前取 revision 用）
 * - create / update / delete：POST / PATCH（revision 乐观锁，409 冲突）/ DELETE
 * 类型统一来自 @shared/work，与 server 校验 schema 同源。
 */
import { apiFetch } from './client';
import type { Work, WorkMode, WorkStats } from '@shared/work';

/** GET /api/works 浅列表项（server listWorks 返回形状，stats 未写入前缺省） */
export interface WorkSummary {
  id: string;
  title: string;
  mode: WorkMode;
  genre: string;
  updatedAt: number;
  stats?: WorkStats;
}

/** 新建作品入参（绑定三类资产 id；regexScriptIds/voiceMap/settings 暂走默认） */
export interface CreateWorkInput {
  title: string;
  mode: WorkMode;
  genre: string;
  characterIds?: string[];
  worldbookIds?: string[];
  presetId?: string;
}

/** 改名入参：revision 取自最新全量 Work（409 冲突时调用方提示刷新） */
export interface UpdateWorkTitleInput {
  revision: number;
  title: string;
}

export async function listWorks(): Promise<WorkSummary[]> {
  return apiFetch<WorkSummary[]>('/api/works');
}

export async function getWork(id: string): Promise<Work> {
  return apiFetch<Work>(`/api/works/${id}`);
}

export async function createWork(input: CreateWorkInput): Promise<Work> {
  return apiFetch<Work>('/api/works', {
    method: 'POST',
    body: JSON.stringify({
      characterIds: [],
      worldbookIds: [],
      presetId: '',
      ...input,
    }),
  });
}

export async function updateWorkTitle(id: string, input: UpdateWorkTitleInput): Promise<Work> {
  return apiFetch<Work>(`/api/works/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** DELETE 幂等（server 删整目录）；204/200 均视为成功 */
export async function deleteWork(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/works/${id}`, { method: 'DELETE' });
}
