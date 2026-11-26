/**
 * 试验台的图片上传（参考图 / 本地产物回流共用）：multer 实例与文件校验。
 */
import multer from 'multer';

import { HttpError } from '../../../middleware/validate';

const IMAGE_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

/** 单文件 20MB 上限（内存存储：试验图与参考图都是一次性的小文件） */
export const uploadLabFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/** multipart 里的图片：缺失 / 类型不支持 / 过小 → 400 人话。allowWebp=false 时只收 png / jpg */
export function uploadedImage(
  file: Express.Multer.File | undefined,
  what: string,
  allowWebp: boolean,
): { buffer: Buffer; ext: string } {
  if (!file) throw new HttpError(400, `请上传${what}（multipart 字段 file）`);
  const ext = IMAGE_MIME[file.mimetype];
  if (!ext || (ext === '.webp' && !allowWebp)) {
    throw new HttpError(400, `${what}只支持${allowWebp ? ' png/jpg/webp' : ' png / jpg'}（收到 ${file.mimetype || '未知类型'}）`);
  }
  if (file.size < 1024) throw new HttpError(400, `${what}内容异常（过小）`);
  return { buffer: file.buffer, ext };
}
