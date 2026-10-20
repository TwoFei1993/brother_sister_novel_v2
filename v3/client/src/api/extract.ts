/**
 * Word 文档提取 API（向导「从 Word 导入」）
 *
 * multipart 上传 .docx → 服务端 mammoth 提取纯文本（段落换行保留）。
 * 非 2xx 由 apiFetch 抛 ApiError（422 = 无法解析/空文档，401 自动跳登录）。
 */
import { apiFetch } from './client';

/** 服务端提取结果：text 为纯文本（段落间换行），chars 为码点字数 */
export interface DocxExtractResult {
  text: string;
  chars: number;
}

/** 上传 .docx 到 /api/extract/docx，返回提取的纯文本 */
export async function extractDocx(file: File): Promise<DocxExtractResult> {
  const fd = new FormData();
  fd.append('file', file);
  return apiFetch<DocxExtractResult>('/api/extract/docx', { method: 'POST', body: fd });
}
