/**
 * 作品 API 封装（设计 §6 /api/works）：书架与写作台共用
 *
 * - list：GET /api/works 浅列表（书架卡片所需字段，按最近更新排序；无 revision/createdAt）
 * - get：GET /api/works/:id 全量 Work（PATCH 前取 revision 用）
 * - create / update / delete：POST / PATCH（revision 乐观锁，409 冲突）/ DELETE
 * - 消息流三窗口读（tail/before/since）+ 幂等 upsert + 单条 PATCH（swipe 切换）
 * 类型统一来自 @shared/work，与 server 校验 schema 同源。
 */
import { apiFetch } from './client';
import type { Message } from '@shared/message';
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

/** 作品设置保存入参（写作台设置抽屉）：全部可选，只传变更项 */
export interface UpdateWorkSettingsInput {
  revision: number;
  title?: string;
  settings?: Work['settings'];
  allowCardOverride?: boolean;
  viewPreference?: Work['viewPreference'];
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
  return updateWork(id, input);
}

/** PATCH /api/works/:id 通用更新（revision 乐观锁；返回更新后的全量 Work，revision+1） */
export async function updateWork(id: string, input: UpdateWorkSettingsInput): Promise<Work> {
  return apiFetch<Work>(`/api/works/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// ---------- 消息流（设计 §4.6 三窗口 / §9.2 幂等入库） ----------

/** GET .../messages 响应：hasMore 仅在 tail/before 模式返回（更早方向还有内容） */
export interface MessagesPage {
  messages: Message[];
  hasMore?: boolean;
}

/** 三窗口读取入参（三选一，与 server messages 路由语义一致） */
export type MessagesQuery = { tail?: number } | { before: string; limit?: number } | { since: string };

function toQueryString(query: MessagesQuery): string {
  const p = new URLSearchParams();
  if ('since' in query) p.set('since', query.since);
  else if ('before' in query) {
    p.set('before', query.before);
    p.set('limit', String(query.limit ?? 50));
  } else p.set('tail', String(query.tail ?? 50));
  return p.toString();
}

export async function listMessages(workId: string, query: MessagesQuery = {}): Promise<MessagesPage> {
  return apiFetch<MessagesPage>(`/api/works/${workId}/messages?${toQueryString(query)}`);
}

/** 生成完成幂等入库（§9.2 upsert 可安全重试） */
export async function upsertMessage(workId: string, message: Message): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/works/${workId}/messages`, {
    method: 'POST',
    body: JSON.stringify(message),
  });
}

/** 单条消息更新（swipe 切换等）：last-write-wins 整条替换 */
export async function patchMessage(workId: string, message: Message): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/works/${workId}/messages/${message.id}`, {
    method: 'PATCH',
    body: JSON.stringify(message),
  });
}

/** DELETE 幂等（server 删整目录）；204/200 均视为成功 */
export async function deleteWork(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/works/${id}`, { method: 'DELETE' });
}
