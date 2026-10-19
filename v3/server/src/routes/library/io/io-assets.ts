/**
 * 三类资产（世界书/预设/正则）JSON 导入/导出路由（Task 25，设计 §6）
 *
 * 挂载（library/index.ts 已接线，与 io-card 同挂 '/io'）：
 *   libraryRouter.use('/io', ioAssetsRouter)
 * 端点（segment ∈ worldbooks | presets | regex-scripts）：
 *   POST /api/io/<segment>/import  multipart 单文件字段 file → 201 资产 JSON
 *   POST /api/io/<segment>/export  body {id} → raw JSON 附件下载
 * 导入管道：multer 内存存储 → JSON.parse → normalize（zod 校验 + 归一化）→ uuid 入库。
 * 导出只回 raw（酒馆原生格式），可直接再导入回本系统或酒馆。
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { normalizePreset, normalizeRegex, normalizeWorldbook } from '../../../converters/tavern';
import { authRequired } from '../../../middleware/auth';
import { HttpError, zodBody } from '../../../middleware/validate';
import { readJson, writeJsonAtomic } from '../../../storage/store';
import { libraryDir } from '../crud';

// ---------- 上传 ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 与 app.ts express.json 上限一致
  // 浏览器 FormData 的 filename 以 UTF-8 传输；busboy 默认按 latin1 解析会乱码
  defParamCharset: 'utf8',
});

// ---------- 三类资产同构配置 ----------

interface AssetKind {
  /** URL 路径段 */
  segment: string;
  /** 存储子目录（libraryDir 相对） */
  dir: string;
  /** 人话错误消息中的资源名 */
  label: string;
  /** 导入规范化（zod 校验 + 归一化，失败抛 400 HttpError） */
  normalize: (raw: unknown, fileName: string) => { name: string; raw: unknown };
}

const KINDS: AssetKind[] = [
  { segment: 'worldbooks', dir: 'worldbooks', label: '世界书', normalize: normalizeWorldbook },
  { segment: 'presets', dir: 'presets', label: '预设', normalize: normalizePreset },
  { segment: 'regex-scripts', dir: 'regex-scripts', label: '正则脚本', normalize: normalizeRegex },
];

const exportBodySchema = z.object({ id: z.string().min(1) });

/** id 白名单（与 crud.ts 同语义）：uuid 字符集天然拒绝 / \ .. 等路径穿越片段 */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 下载文件名只保留字母数字/中日韩文字/空格连字符下划线点，其余转下划线 */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _.-]+/gu, '_').trim();
  return cleaned === '' ? 'export' : cleaned.slice(0, 80);
}

/** 剥掉扩展名得到资产展示名（"Eldoria.json" → "Eldoria"） */
function stripExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return base.trim();
}

/** 解析上传文件内容为 JSON，失败 400 人话错误 */
function parseUploadedJson(buffer: Buffer, label: string): unknown {
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, `上传的${label}文件不是合法的 JSON`);
  }
}

// ---------- 单类资产的 import/export 子路由 ----------

function buildKindRouter(kind: AssetKind): Router {
  const router = Router();
  const fileOf = (id: string): string => join(libraryDir(kind.dir), `${id}.json`);

  // POST /import：multipart 单文件 → 规范化 → uuid 入库 → 201 回全量资产
  router.post('/import', upload.single('file'), async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) throw new HttpError(400, `请上传${kind.label}文件（multipart 字段 file）`);
      const parsed = parseUploadedJson(file.buffer, kind.label);
      const { name, raw } = kind.normalize(parsed, stripExt(file.originalname));
      const asset = { id: randomUUID(), name, raw };
      await writeJsonAtomic(fileOf(asset.id), asset);
      res.status(201).json(asset);
    } catch (err) {
      next(err);
    }
  });

  // POST /export：{id} → raw JSON 附件下载（不存在 404，body 缺 id 由 zodBody 400）
  router.post('/export', zodBody(exportBodySchema), async (req, res, next) => {
    try {
      const { id } = req.body as z.infer<typeof exportBodySchema>;
      if (!ID_PATTERN.test(id)) throw new HttpError(404, `${kind.label}不存在`);
      const asset = await readJson<{ id: string; name: string; raw: unknown }>(fileOf(id));
      if (!asset) throw new HttpError(404, `${kind.label}不存在`);
      const filename = `${safeFileName(asset.name)}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      res.send(JSON.stringify(asset.raw, null, 2));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// ---------- 汇总路由（自带鉴权：独立测试装配与挂入 libraryRouter 均受保护） ----------

export const ioAssetsRouter = Router();

ioAssetsRouter.use(authRequired);

for (const kind of KINDS) {
  ioAssetsRouter.use(`/${kind.segment}`, buildKindRouter(kind));
}
