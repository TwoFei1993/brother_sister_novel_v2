/**
 * 短剧资产库路由（discuss/2026-11-18-短剧资产库设计.md）：
 * - 三类 CRUD（characters/scenes/styles）复用 crudRouter 工厂
 * - POST /import-from/:workId  从作品提取资产（含图片复制与 path 改写，sheetImages 空时按文件名规律扫描兜底）
 * - POST /:type/:assetId/to-work/:workId  资产导入作品（图片落 work/images，project.json 合并）
 *
 * 路径语义：资产内 StoredImage.path 相对 DATA_DIR；作品内相对 work 目录。改写只发生在复制时。
 */
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';

import {
  DUANJU_ASSET_TYPES,
  DuanjuCharacterAssetSchema,
  DuanjuSceneAssetSchema,
  DuanjuStyleAssetSchema,
  type DuanjuAssetType,
} from '@shared/duanju-asset';
import type { DuanjuCharacter, DuanjuScene, StoredImage } from '@shared/duanju';

import { HttpError, zodBody } from '../../middleware/validate';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { crudRouter, libraryDir } from './crud';

/** 资产 JSON 目录：DATA_DIR/duanju-assets/<type> */
const assetDirOf = (type: DuanjuAssetType) => libraryDir(`duanju-assets/${type}`);
/** 资产图片目录：DATA_DIR/duanju-assets/files/<type>/<assetId>（StoredImage.path 相对 DATA_DIR） */
const assetFilesDir = (type: DuanjuAssetType, assetId: string) =>
  libraryDir(`duanju-assets/files/${type}/${assetId}`);
/** 作品短剧目录：DATA_DIR/works/<workId>/duanju */
const workDuanjuDir = (workId: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(workId)) throw new HttpError(400, '非法作品 id');
  return resolve(libraryDir('works'), workId, 'duanju');
};

const safeName = (name: string) => name.replace(/[\\/:*?"<>|\s]+/g, '');

// strictObject.extend 的 zod 类型推断过不了 CrudOptions 的 ZodType 泛型（id 推成 unknown），
// 与 crud.ts 内部的处理一致：运行时校验正确，此处一次显式转型收敛。
export const charactersRouter = crudRouter({
  dirOf: () => assetDirOf('characters'),
  schema: DuanjuCharacterAssetSchema as unknown as import('zod').ZodType<import('@shared/duanju-asset').DuanjuCharacterAsset>,
  label: '短剧角色资产',
  idempotentByName: true,
});
export const scenesRouter = crudRouter({
  dirOf: () => assetDirOf('scenes'),
  schema: DuanjuSceneAssetSchema as unknown as import('zod').ZodType<import('@shared/duanju-asset').DuanjuSceneAsset>,
  label: '短剧场景资产',
});
export const stylesRouter = crudRouter({
  dirOf: () => assetDirOf('styles'),
  schema: DuanjuStyleAssetSchema as unknown as import('zod').ZodType<import('@shared/duanju-asset').DuanjuStyleAsset>,
  label: '短剧风格资产',
});

/** 迁移兜底：作品 images/ 下按「<名>-特写|三视图|场景.png」命名规律扫描（手工入库的老作品无 sheetImages 记录） */
async function scanWorkImages(workImgDir: string, name: string, kind: string): Promise<StoredImage[]> {
  let files: string[] = [];
  try {
    files = await readdir(workImgDir);
  } catch {
    return [];
  }
  const hit = files.filter((f) => f.startsWith(`${name}-${kind}`) && /\.(png|jpg|jpeg|webp)$/i.test(f));
  const now = Date.now();
  return hit.map((f) => ({
    id: randomUUID(),
    path: `duanju/images/${f}`,
    prompt: '迁移扫描（无原始提示词）',
    createdAt: now,
  }));
}

/** 把 StoredImage 指向的文件从作品复制进资产目录，返回改写 path 后的记录 */
async function copyIntoAssets(
  workId: string, type: DuanjuAssetType, assetId: string, img: StoredImage,
): Promise<StoredImage> {
  // StoredImage.path 相对 work 根目录（data/works/<id>/），如 duanju/images/xx.png
  const src = join(resolve(libraryDir('works'), workId), img.path);
  const dstDir = assetFilesDir(type, assetId);
  await mkdir(dstDir, { recursive: true });
  const fname = `${img.id}${basename(img.path).match(/\.[a-z0-9]+$/i)?.[0] ?? '.png'}`;
  await copyFile(src, join(dstDir, fname));
  return { ...img, path: `duanju-assets/files/${type}/${assetId}/${fname}` };
}

const ImportBodySchema = z.object({
  type: z.enum(DUANJU_ASSET_TYPES),
  scanImages: z.boolean().optional(),
});

async function importFromWork(req: Request): Promise<unknown> {
  const workId = req.params.workId as string;
  const body = ImportBodySchema.parse(req.body);
  const duDir = workDuanjuDir(workId);
  const proj = await readJson<Record<string, unknown>>(join(duDir, 'project.json'));
  if (!proj) throw new HttpError(404, `作品 ${workId} 无 duanju/project.json`);
  const now = Date.now();
  const imported: string[] = [];
  const skipped: string[] = [];

  if (body.type === 'characters') {
    const chars = (proj.characters as DuanjuCharacter[]) ?? [];
    for (const c of chars) {
      const assetId = randomUUID();
      let imgs = c.sheetImages ?? [];
      if (body.scanImages !== false && imgs.length === 0) {
        imgs = await scanWorkImages(join(duDir, 'images'), c.name, '特写');
      }
      const sheet = [] as StoredImage[];
      for (const img of imgs) {
        try { sheet.push(await copyIntoAssets(workId, 'characters', assetId, img)); } catch { /* 源文件缺失则跳过该图 */ }
      }
      await writeJsonAtomic(join(assetDirOf('characters'), `${assetId}.json`), {
        ...c, id: assetId, sheetImages: sheet,
        refImageId: sheet[0]?.id ?? null,
        tags: [], sourceWorkId: workId, createdAt: c.createdAt ?? now, updatedAt: now,
      });
      imported.push(c.name);
    }
  } else if (body.type === 'scenes') {
    const scenes = (proj.scenes as DuanjuScene[]) ?? [];
    for (const s of scenes) {
      const assetId = randomUUID();
      let imgs = s.images ?? [];
      if (body.scanImages !== false && imgs.length === 0) {
        imgs = await scanWorkImages(join(duDir, 'images'), s.name, '场景');
      }
      const sceneImgs = [] as StoredImage[];
      for (const img of imgs) {
        try { sceneImgs.push(await copyIntoAssets(workId, 'scenes', assetId, img)); } catch { /* 同上 */ }
      }
      await writeJsonAtomic(join(assetDirOf('scenes'), `${assetId}.json`), {
        ...s, id: assetId, images: sceneImgs,
        tags: [], sourceWorkId: workId, createdAt: s.createdAt ?? now, updatedAt: now,
      });
      imported.push(s.name);
    }
  } else {
    const name = safeName(String(proj.title ?? workId)) || workId;
    await writeJsonAtomic(join(assetDirOf('styles'), `${randomUUID()}.json`), {
      id: randomUUID(), name,
      style: String(proj.style ?? ''), visualSignature: String(proj.visualSignature ?? ''),
      tags: [], sourceWorkId: workId, createdAt: now, updatedAt: now,
    });
    imported.push(name);
  }
  return { imported, skipped };
}

async function toWork(req: Request): Promise<unknown> {
  const { type, assetId, workId } = req.params as Record<string, string>;
  if (!(DUANJU_ASSET_TYPES as readonly string[]).includes(type)) throw new HttpError(400, '非法资产类型');
  if (!/^[A-Za-z0-9_-]+$/.test(assetId)) throw new HttpError(400, '非法资产 id');
  const duDir = workDuanjuDir(workId);
  const proj = await readJson<Record<string, unknown>>(join(duDir, 'project.json'));
  if (!proj) throw new HttpError(404, `作品 ${workId} 无 duanju/project.json`);
  const asset = await readJson<Record<string, unknown>>(join(assetDirOf(type as DuanjuAssetType), `${assetId}.json`));
  if (!asset) throw new HttpError(404, '资产不存在');
  const now = Date.now();

  if (type === 'styles') {
    if (!proj.style) proj.style = asset.style;
    if (!proj.visualSignature) proj.visualSignature = asset.visualSignature;
    await writeJsonAtomic(join(duDir, 'project.json'), proj);
    return { applied: 'style' };
  }

  // 图片落 work：duanju/images/<uuid><ext>，path 改写为 work 相对路径
  const imgs = (asset.sheetImages ?? asset.images ?? []) as StoredImage[];
  const workImgDir = join(duDir, 'images');
  await mkdir(workImgDir, { recursive: true });
  const newImgs: StoredImage[] = [];
  for (const img of imgs) {
    const src = resolve(libraryDir('.'), img.path);
    const fname = `${randomUUID()}${basename(img.path).match(/\.[a-z0-9]+$/i)?.[0] ?? '.png'}`;
    await copyFile(src, join(workImgDir, fname));
    newImgs.push({ ...img, path: `duanju/images/${fname}` });
  }
  const strip = { tags: undefined as never, sourceWorkId: undefined as never };
  const fresh = { ...asset, ...strip, id: randomUUID(), createdAt: now, updatedAt: now };
  if (type === 'characters') {
    (fresh as Record<string, unknown>).sheetImages = newImgs;
    (fresh as Record<string, unknown>).refImageId = newImgs[0]?.id ?? null;
    (proj.characters as unknown[]).push(fresh);
  } else {
    (fresh as Record<string, unknown>).images = newImgs;
    (proj.scenes as unknown[]).push(fresh);
  }
  await writeJsonAtomic(join(duDir, 'project.json'), proj);
  return { applied: type, newId: fresh.id };
}

export const duanjuAssetsRouter = Router();
duanjuAssetsRouter.use('/characters', charactersRouter);
duanjuAssetsRouter.use('/scenes', scenesRouter);
duanjuAssetsRouter.use('/styles', stylesRouter);
duanjuAssetsRouter.post('/import-from/:workId', zodBody(ImportBodySchema), (req: Request, res: Response, next: NextFunction) => {
  importFromWork(req).then((r) => { res.json(r); }, next);
});
duanjuAssetsRouter.post('/:type/:assetId/to-work/:workId', (req, res, next) => {
  toWork(req).then((r) => { res.json(r); }, next);
});

/** 资产图片流式返回（同 works/duanju/files 的白名单防穿越约定） */
const IMG_EXT = /\.(png|jpe?g|webp)$/i;
duanjuAssetsRouter.get('/files/:type/:assetId/:name', (req, res, next) => {
  try {
    const { type, assetId, name } = req.params as Record<string, string>;
    if (!(DUANJU_ASSET_TYPES as readonly string[]).includes(type)) throw new HttpError(400, '非法资产类型');
    if (!/^[A-Za-z0-9_-]+$/.test(assetId)) throw new HttpError(400, '非法资产 id');
    if (!IMG_EXT.test(name) || name.includes('..')) throw new HttpError(400, '非法文件名');
    const file = join(assetFilesDir(type as DuanjuAssetType, assetId), name);
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) next(new HttpError(404, '文件不存在'));
    });
  } catch (e) { next(e); }
});
