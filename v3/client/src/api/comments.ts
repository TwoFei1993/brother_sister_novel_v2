/**
 * 划线评论 API（安卓 app Phase1）：全量读 / 幂等 upsert / 删除
 */
import { apiFetch } from './client';
import type { Comment } from '@shared/comment';

export async function listComments(workId: string): Promise<Comment[]> {
  const r = await apiFetch<{ comments: Comment[] }>(`/api/works/${workId}/comments`);
  return r.comments;
}

export async function upsertComment(workId: string, comment: Comment): Promise<void> {
  await apiFetch(`/api/works/${workId}/comments`, { method: 'POST', body: JSON.stringify(comment) });
}

export async function deleteComment(workId: string, commentId: string): Promise<void> {
  await apiFetch(`/api/works/${workId}/comments/${commentId}`, { method: 'DELETE' });
}
