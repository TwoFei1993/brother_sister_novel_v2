/**
 * 短剧试验台 API（设计共识 2026-11-26 第 2.5 节；M2：参考图）
 * 请求体类型与校验 schema 在 shared/duanju/lab（与服务端同源）。
 */
import { apiFetch } from './client';
import type { LabGenerateBody, LabRecord, LabUploadMeta } from '@shared/duanju/lab';

/** 历史记录（时间正序，最新在末尾） */
export async function listLabRecords(workId: string): Promise<LabRecord[]> {
  return (await apiFetch<{ records: LabRecord[] }>(`/api/works/${workId}/duanju/lab`)).records;
}

/** 云端通道：服务端生成并转存，返回记录 */
export async function generateLabCloud(workId: string, body: LabGenerateBody): Promise<LabRecord> {
  return (await apiFetch<{ record: LabRecord }>(`/api/works/${workId}/duanju/lab/generate`, {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 8 * 60_000, // 上游含重试与下载最长约 7 分钟
  })).record;
}

/** 本地通道产物回流（浏览器直连引擎生成后归档），返回最新历史 */
export async function uploadLabComfy(workId: string, file: File, meta: LabUploadMeta): Promise<LabRecord[]> {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  form.append('file', file);
  return (await apiFetch<{ records: LabRecord[] }>(`/api/works/${workId}/duanju/lab/images`, { method: 'POST', body: form }))
    .records;
}

/** 上传参考图（添加即上传），返回可写进记录的路径 */
export async function uploadLabRef(workId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  return (await apiFetch<{ path: string }>(`/api/works/${workId}/duanju/lab/refs`, { method: 'POST', body: form })).path;
}

/** 删除一条记录及其图片，返回最新历史 */
export async function deleteLabRecord(workId: string, recordId: string): Promise<LabRecord[]> {
  return apiFetch<{ records: LabRecord[] }>(`/api/works/${workId}/duanju/lab/${recordId}`, { method: 'DELETE' }).then(
    (r) => r.records,
  );
}
