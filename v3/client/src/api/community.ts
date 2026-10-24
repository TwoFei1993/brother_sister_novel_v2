/**
 * 留言板 API（P3.2）：GET 全量 / POST 发言 / POST 回复（作者）/ DELETE（作者或本人）
 */
import { apiFetch } from './client';
import type { BoardEntry, BoardType } from '@shared/community';

export async function listBoard(): Promise<BoardEntry[]> {
  const r = await apiFetch<{ entries: BoardEntry[] }>('/api/community');
  return r.entries;
}

export async function postEntry(type: BoardType, text: string): Promise<BoardEntry> {
  return apiFetch<BoardEntry>('/api/community', { method: 'POST', body: JSON.stringify({ type, text }) });
}

export async function replyEntry(id: string, text: string): Promise<BoardEntry> {
  return apiFetch<BoardEntry>(`/api/community/${id}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
}

export async function deleteEntry(id: string): Promise<void> {
  await apiFetch(`/api/community/${id}`, { method: 'DELETE' });
}
