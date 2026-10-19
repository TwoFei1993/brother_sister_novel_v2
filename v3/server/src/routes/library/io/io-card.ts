/**
 * 角色卡导入导出路由（Task 24）：ioCardRouter 自带 authRequired。
 * 挂载方式（library/index.ts 已接线）：
 *   libraryRouter.use('/io', ioCardRouter);  // app.use('/api', libraryRouter) 于 app.ts
 * 对外端点（路由内为相对路径）：
 *   POST /api/io/characters/import  multipart（file 字段 png/json 二选一）→ 201 CharacterAsset
 *   POST /api/io/characters/export  body {id, format:'png'|'json'} → 文件下载
 * 存储：data/characters/<uuid>.json（资产）+ <uuid>.png（头像底图）。
 * avatar 暂存本地路径 /data-assets/characters/<uuid>.png，静态托管由后续任务接入。
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import type { CharacterAsset } from '@shared/card';

import { authRequired } from '../../../middleware/auth';
import { HttpError, zodBody } from '../../../middleware/validate';
import { writeJsonAtomic, readJson } from '../../../storage/store';
import { libraryDir } from '../crud';
import { createPlaceholderPng, extractCardData, toInternalCard, writeCardData } from '../../../converters/card-png';

// ---------- 装置 ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB：卡 PNG 通常 < 5MB，防滥用
});

/** 每请求求值，测试注入 DATA_DIR 即生效（与 crud.ts 同语义） */
const charDir = (): string => libraryDir('characters');

/** 与 crud.ts 相同的 id 白名单：uuid 字符集，天然拒绝路径穿越 */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const ioCardRouter = Router();

ioCardRouter.use(authRequired);

// ---------- 导入 ----------

/** 按 mimetype 优先、扩展名兜底分流文件类型 */
function kindOf(file: Express.Multer.File): 'png' | 'json' | null {
  const name = file.originalname.toLowerCase();
  if (file.mimetype === 'image/png' || name.endsWith('.png')) return 'png';
  if (file.mimetype === 'application/json' || name.endsWith('.json')) return 'json';
  return null;
}

/** 落盘 <uuid>.json；携带 PNG 底图时先写 <uuid>.png 并登记 avatar 路径（资源中心导入复用） */
export async function persist(asset: CharacterAsset, png?: Buffer): Promise<void> {
  const dir = charDir();
  await mkdir(dir, { recursive: true });
  if (png) {
    await writeFile(join(dir, `${asset.id}.png`), png);
    asset.avatar = `/data-assets/characters/${asset.id}.png`;
  }
  await writeJsonAtomic(join(dir, `${asset.id}.json`), asset);
}

ioCardRouter.post('/characters/import', upload.single('file'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) throw new HttpError(400, '请通过 file 字段上传角色卡文件（png 或 json）');
    const kind = kindOf(file);
    if (!kind) throw new HttpError(400, '仅支持 png 或 json 格式的角色卡');

    let tavernJson: unknown;
    if (kind === 'png') {
      try {
        tavernJson = extractCardData(file.buffer);
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : 'PNG 解析失败');
      }
    } else {
      try {
        tavernJson = JSON.parse(file.buffer.toString('utf8')) as unknown;
      } catch {
        throw new HttpError(400, 'JSON 角色卡文件内容不合法');
      }
    }

    const asset = toInternalCard(tavernJson);
    await persist(asset, kind === 'png' ? file.buffer : undefined);
    res.status(201).json(asset);
  } catch (err) {
    next(err);
  }
});

// ---------- 导出 ----------

const exportSchema = z.object({
  id: z.string().min(1),
  format: z.enum(['png', 'json']),
});

ioCardRouter.post('/characters/export', zodBody(exportSchema), async (req, res, next) => {
  try {
    const { id, format } = req.body as z.infer<typeof exportSchema>;
    if (!ID_PATTERN.test(id)) throw new HttpError(404, '角色卡不存在');
    const asset = await readJson<CharacterAsset>(join(charDir(), `${id}.json`));
    if (!asset) throw new HttpError(404, '角色卡不存在');
    const filename = `card-${id}.${format}`;

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(asset);
      return;
    }

    // png：优先以已存头像 PNG 为底（保留原画），缺失则程序生成占位 PNG
    let base: Buffer;
    try {
      base = await readFile(join(charDir(), `${id}.png`));
    } catch {
      base = createPlaceholderPng();
    }
    const out = writeCardData(base, asset.card as Record<string, unknown>);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(out);
  } catch (err) {
    next(err);
  }
});
