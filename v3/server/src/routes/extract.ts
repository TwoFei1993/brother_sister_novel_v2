/**
 * Word 文档文本提取路由（向导「从 Word 导入」，用户需求：抽取不能只有复制粘贴）
 *
 * 挂载（app.ts）：app.use('/api/extract', extractRouter)
 * 端点：
 *   POST /api/extract/docx  multipart 单文件字段 file（.docx，限 20MB）→ { text, chars }
 * 管道：multer 内存存储 → mammoth.extractRawText（保留段落换行）→ 纯文本直出。
 * 空文本 / 解析失败一律 422 人话；超限 413 由 app.ts errorHandler 统一转译。
 */
import { Router } from 'express';
import mammoth from 'mammoth';
import multer from 'multer';

import { authRequired } from '../middleware/auth';
import { HttpError } from '../middleware/validate';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 小说文档远小于此；与角色卡导入同量级防御
  defParamCharset: 'utf8', // 中文文件名不乱码（与 io-assets 同约定）
});

/** 码点计数：中文一字一码点，符合用户直觉的「字数」 */
function countChars(text: string): number {
  return [...text].length;
}

export const extractRouter = Router();

extractRouter.use(authRequired);

extractRouter.post('/docx', upload.single('file'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) throw new HttpError(400, '请上传 Word 文档（multipart 字段 file）');
    let text: string;
    try {
      const { value } = await mammoth.extractRawText({ buffer: file.buffer });
      text = value;
    } catch {
      throw new HttpError(422, '无法从该 Word 文档提取文字，请确认是有效的 .docx 文件');
    }
    if (text.trim() === '') {
      throw new HttpError(422, '该 Word 文档中没有可提取的文字内容');
    }
    res.json({ text, chars: countChars(text) });
  } catch (err) {
    next(err);
  }
});
