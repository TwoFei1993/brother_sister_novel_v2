/**
 * 短剧试验台路由——记录（设计共识 2026-11-26 第 2.5 节；M2：参考图）
 *
 * GET    /works/:id/duanju/lab           → 历史记录
 * POST   /works/:id/duanju/lab/generate   → 云端通道生成并归档（可带 1 张参考图，仅 Seedream）
 * POST   /works/:id/duanju/lab/images     → 本地通道产物回流归档（multipart：file + meta）
 * POST   /works/:id/duanju/lab/refs       → 上传参考图（见 ./refs）
 * DELETE /works/:id/duanju/lab/:recordId  → 删除记录及其图片、不再被引用的参考图
 *
 * 记录存 duanju/lab.json（与 project.json 分离：不参与乐观锁）。lab.json 的读-改-写一律走
 * withWorkLock（与 project.json 共用该作品的写队列）；上游生成与落图不持锁（最长约 7 分钟）。
 * 不复用 images/upload——那条路由会 bump project revision 并写成本记录，试验图不要这些副作用。
 * 生成失败不落记录；写记录失败时回滚已落的图片。请求体校验 schema 在 shared（与客户端类型同源）。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RequestHandler } from 'express';
import { Router } from 'express';

import { HttpError, zodBody } from '../../../middleware/validate';
import { withWorkLock } from '../../../middleware/writer';
import { readJson, writeJsonAtomic } from '../../../storage/store';
import {
  EMPTY_LAB_FILE,
  LAB_RECORDS_MAX,
  LabFileSchema,
  LabGenerateBodySchema,
  LabUploadMetaSchema,
  type LabFile,
  type LabGenerateBody,
  type LabRecord,
  type LabUploadMeta,
} from '@shared/duanju/lab';
import { assertSafeId, worksDir, wrap } from '../../works/works';
import { readDuanjuProject } from '../project';
import { ImageError, callImageGeneration, downloadAndStore, workImagesDir } from '../../../services/image';
import { keepExistingRefs, resolveCloudRef, sweepOrphanRefs, uploadLabRef } from './refs';
import { uploadLabFile, uploadedImage } from './upload';

// ---------- 存储 ----------

function labFile(workId: string): string {
  return join(worksDir(), workId, 'duanju', 'lab.json');
}

/** 读历史（文件缺失或损坏 → 空列表：试验记录可丢，不阻塞界面） */
async function readLab(workId: string): Promise<LabFile> {
  const parsed = LabFileSchema.safeParse(await readJson<unknown>(labFile(workId)));
  return parsed.success ? parsed.data : EMPTY_LAB_FILE;
}

/** 持锁追加；超出上限淘汰最旧的（连同它的产物图），随后清理没人再用的参考图 */
async function appendRecord(workId: string, record: LabRecord): Promise<void> {
  await withWorkLock(workId, async () => {
    const all = [...(await readLab(workId)).records, record];
    const kept = all.slice(-LAB_RECORDS_MAX);
    await writeJsonAtomic(labFile(workId), { records: kept } satisfies LabFile);
    for (const evicted of all.slice(0, all.length - kept.length)) await unlinkImage(workId, evicted.image.path);
    await sweepOrphanRefs(workId, kept);
  });
}

/** 新记录的 id 前缀（短 id：记录不跨作品引用） */
const newId = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`;

/** 删作品图片目录里的一个文件。只取文件名段再拼进目录——记录里的路径由服务端生成，仍防一手目录穿越 */
function unlinkImage(workId: string, path: string): Promise<void> {
  const baseDir = join(worksDir(), workId, 'duanju', 'images');
  const file = resolve(baseDir, path.split('/').pop() ?? '');
  return file.startsWith(baseDir) ? unlink(file).catch(() => undefined) : Promise.resolve();
}

// ---------- GET：历史 ----------

export const listLabRecords: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  res.json(await readLab(id));
};

// ---------- POST：云端生成并归档 ----------

export const generateLabImage: RequestHandler = async (req, res, next) => {
  const id = req.params.id;
  try {
    assertSafeId(id);
    const input = req.body as LabGenerateBody;
    const t0 = Date.now();
    await readDuanjuProject(id); // 作品 / 短剧项目不存在 → 404（先于花钱的上游调用）
    const subjectRefPath = await resolveCloudRef(id, input.provider, input.refs);
    const [url] = await callImageGeneration({
      prompt: input.prompt,
      aspectRatio: input.aspect,
      provider: input.provider,
      subjectRefPath,
    });
    const stored = await downloadAndStore(id, url);
    const createdAt = Date.now();
    const record: LabRecord = {
      id: newId('lab'),
      createdAt,
      brief: input.brief,
      prompt: input.prompt,
      kind: input.kind,
      provider: input.provider,
      aspect: input.aspect,
      width: input.width,
      height: input.height,
      seed: 0, // 云端通道不可指定种子
      refs: subjectRefPath ? [input.refs[0]!] : [],
      characterIds: input.characterIds,
      sceneIds: input.sceneIds,
      image: {
        id: newId('img'),
        path: stored.path,
        prompt: input.prompt,
        createdAt,
        originUrl: stored.originUrl,
      },
      elapsedSec: Math.round((createdAt - t0) / 1000),
    };
    try {
      await appendRecord(id, record);
    } catch (err) {
      await unlinkImage(id, stored.path); // 记录没写成：回滚刚转存的图，不留孤儿（本地回流那条同此规矩）
      throw err;
    }
    res.status(201).json({ record });
  } catch (err) {
    if (err instanceof ImageError) {
      res.status(502).json({ code: err.code, message: err.message });
      return;
    }
    next(err);
  }
};

// ---------- POST：本地产物回流 ----------

/** 解析 multipart 的 meta 字段（缺失 / 非 JSON / 不合 schema → 400 人话） */
function parseUploadMeta(raw: unknown): LabUploadMeta {
  let value: unknown = null;
  try {
    value = JSON.parse(String(raw ?? 'null'));
  } catch {
    throw new HttpError(400, '试验记录元数据不是合法 JSON（字段 meta）');
  }
  const parsed = LabUploadMetaSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, '试验记录元数据不合法（字段 meta）');
  return parsed.data;
}

export const uploadLabImage: RequestHandler = async (req, res, next) => {
  const id = req.params.id;
  try {
    assertSafeId(id);
    const { buffer, ext } = uploadedImage(req.file, '图片文件', true);
    const m = parseUploadMeta(req.body?.meta);
    await readDuanjuProject(id); // 作品必须存在：否则不在其目录下落图

    const dir = workImagesDir(id);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${ext}`;
    const createdAt = Date.now();
    try {
      await writeFile(join(dir, name), buffer);
      await appendRecord(id, {
        id: newId('lab'),
        createdAt,
        brief: m.brief,
        prompt: m.prompt,
        kind: m.kind,
        provider: 'comfy',
        aspect: m.aspect,
        width: m.width,
        height: m.height,
        seed: m.seed,
        refs: await keepExistingRefs(id, m.refs),
        characterIds: m.characterIds,
        sceneIds: m.sceneIds,
        image: { id: newId('img'), path: `duanju/images/${name}`, prompt: m.prompt, createdAt },
        elapsedSec: m.elapsedSec,
      });
    } catch (err) {
      await unlink(join(dir, name)).catch(() => undefined); // 归档失败回滚盘文件，不留孤儿
      throw err;
    }
    res.status(201).json({ records: (await readLab(id)).records });
  } catch (err) {
    next(err);
  }
};

// ---------- DELETE：删除记录及图片 ----------

export const deleteLabRecord: RequestHandler = async (req, res) => {
  const id = req.params.id;
  const recordId = req.params.recordId;
  assertSafeId(id);
  const removed = await withWorkLock(id, async (): Promise<{ record: LabRecord; remaining: LabRecord[] } | null> => {
    const cur = await readLab(id);
    const target = cur.records.find((r) => r.id === recordId);
    if (!target) return null;
    const remaining = cur.records.filter((r) => r.id !== recordId);
    await writeJsonAtomic(labFile(id), { records: remaining } satisfies LabFile);
    return { record: target, remaining };
  });
  if (!removed) throw new HttpError(404, '记录不存在');
  await unlinkImage(id, removed.record.image.path);
  // 参考图可能被多条记录共用：别的记录还在用的不删
  const stillUsed = new Set(removed.remaining.flatMap((r) => r.refs.map((x) => x.path)));
  for (const ref of removed.record.refs) {
    if (!stillUsed.has(ref.path)) await unlinkImage(id, ref.path);
  }
  res.json(await readLab(id));
};

export function mountDuanjuLab(router: Router): void {
  router.get('/works/:id/duanju/lab', wrap(listLabRecords));
  router.post('/works/:id/duanju/lab/generate', zodBody(LabGenerateBodySchema), wrap(generateLabImage));
  router.post('/works/:id/duanju/lab/images', uploadLabFile.single('file'), wrap(uploadLabImage));
  router.post('/works/:id/duanju/lab/refs', uploadLabFile.single('file'), wrap(uploadLabRef));
  router.delete('/works/:id/duanju/lab/:recordId', wrap(deleteLabRecord));
}
