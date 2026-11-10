/**
 * 短剧生图路由（共识 D1/D6 / 实施计划 T2.2）
 *
 * POST /works/:id/duanju/images —— 生成并转存：
 *   {kind:'character'|'scene', refId, prompt, aspectRatio?, refImageId?}
 *   慢操作（上游 15-30s）不持锁；完成后持锁追加 StoredImage 并 bump 实体 updatedAt
 *   （下游 stale 联动的事实源）。refImageId=角色主参考图（Data URL 传法，spike S8）。
 * GET /works/:id/duanju/files/:name —— 转存产物流式返回（白名单扩展名，防穿越）。
 *
 * 错误语义：ImageError(IMG_*) → 502 {code,message}（前端人话）；project 缺 404。
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import multer from 'multer';
import { mkdir, writeFile } from 'node:fs/promises';
import { HttpError, zodBody } from '../../middleware/validate';
import { withWorkLock } from '../../middleware/writer';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { randomUUID } from 'node:crypto';
import type { DuanjuProject, SpendEntry, StoredImage } from '@shared/duanju';
import { assertSafeId, worksDir, wrap } from '../works/works';
import { duanjuFile, readDuanjuProject } from './project';
import { ImageError, callImageGeneration, downloadAndStore } from '../../services/image';
import { workImagesDir } from '../../services/image';

// ---------- POST：生成并转存 ----------

const genSchema = z.strictObject({
  kind: z.enum(['character', 'scene', 'shot', 'frame']),
  refId: z.string().min(1),
  prompt: z.string().min(1).max(1500),
  aspectRatio: z.string().optional(),
  /** 生图通道（client 按用户设置透传；缺省 minimax） */
  provider: z.enum(['minimax', 'zhipu', 'seedream']).optional(),
  /** 参考图（角色 sheetImage id）：生成时保持人物一致 */
  refImageId: z.string().min(1).optional(),
  /** 分帧号（kind='frame' 必填 1-4） */
  frameIndex: z.number().int().min(1).max(4).optional(),
});

/** 无锁读 project 解析参考图绝对路径（不存在返回 null） */
async function resolveRefPath(id: string, refId: string, refImageId: string): Promise<string | null> {
  const project = await readJson<DuanjuProject>(duanjuFile(id));
  if (!project) return null;
  if (refId.startsWith('char-') || project.characters.some((c) => c.id === refId)) {
    const char = project.characters.find((c) => c.id === refId);
    const img = char?.sheetImages.find((i) => i.id === refImageId);
    if (img) return join(worksDir(), id, img.path);
  }
  return null;
}

/** BuiltFrom 快照：以「本次生成所依据的上游态」为准（shot 整图与 frame 共用） */
function snapshotBuiltFrom(project: DuanjuProject, shot: import('@shared/duanju').DuanjuShot): void {
  const charAt: Record<string, number> = {};
  for (const cid of shot.characterIds) {
    const c = project.characters.find((x) => x.id === cid);
    if (c) charAt[cid] = c.updatedAt;
  }
  const sceneAt: Record<string, number> = {};
  if (shot.sceneId) {
    const s = project.scenes.find((x) => x.id === shot.sceneId);
    if (s) sceneAt[s.id] = s.updatedAt;
  }
  shot.builtFrom = { scriptAt: project.script.updatedAt, charAt, sceneAt };
}

/** spendLog 追加 + cap（成本仪表盘事实源） */
function appendSpend(project: DuanjuProject, kind: SpendEntry['kind'], refId: string, note?: string): void {
  const entry: SpendEntry = { ts: Date.now(), kind, refId, ...(note ? { note } : {}) };
  project.spendLog = [...(project.spendLog ?? []), entry].slice(-5000);
}

/** 持锁落图：character/scene 追加；shot 替换 gridImage（旧模式）；frame 挂/换帧 + rolls+1。spendNote 覆盖记账备注（本地免费图标注豁免成本估算） */
async function attachImage(
  id: string,
  kind: 'character' | 'scene' | 'shot' | 'frame',
  refId: string,
  image: StoredImage,
  frameIndex?: number,
  spendNote?: string,
): Promise<DuanjuProject> {
  return withWorkLock(id, async () => {
    const project = await readJson<DuanjuProject>(duanjuFile(id));
    if (!project) throw new HttpError(404, '短剧项目不存在');
    const now = Date.now();
    if (kind === 'character') {
      const char = project.characters.find((c) => c.id === refId);
      if (!char) throw new HttpError(404, '角色不存在');
      char.sheetImages.push(image);
      if (!char.refImageId) char.refImageId = image.id; // 首图自动设为主参考图
      char.updatedAt = now;
    } else if (kind === 'scene') {
      const scene = project.scenes.find((s) => s.id === refId);
      if (!scene) throw new HttpError(404, '场景不存在');
      scene.images.push(image);
      scene.updatedAt = now;
    } else {
      const shot = project.shots.find((s) => s.id === refId);
      if (!shot) throw new HttpError(404, '镜头不存在');
      if (kind === 'frame') {
        if (!frameIndex) throw new HttpError(400, 'frameIndex 缺失');
        const frames = shot.frames ?? [];
        const prev = frames.find((f) => f.index === frameIndex);
        shot.frames = [
          ...frames.filter((f) => f.index !== frameIndex),
          { index: frameIndex, image, rolls: (prev?.rolls ?? -1) + 1 },
        ].sort((a, b) => a.index - b.index);
      } else {
        shot.gridImage = image; // 旧整图模式（兼容保留）
      }
      snapshotBuiltFrom(project, shot);
      shot.updatedAt = now;
    }
    appendSpend(project, kind, refId, spendNote ?? (frameIndex ? `frame-${frameIndex}` : undefined));
    project.updatedAt = now;
    // 与 project PATCH 语义同步 +1，保证客户端拿最新态
    project.revision += 1;
    await writeJsonAtomic(duanjuFile(id), project);
    return project;
  });
}

export const generateDuanjuImage: RequestHandler = async (req, res, next) => {
  const id = req.params.id;
  try {
    assertSafeId(id);
    const input = req.body as z.infer<typeof genSchema>;
    if (input.kind === 'frame' && !input.frameIndex) throw new HttpError(400, 'frameIndex 缺失');
    // ① 确认 project 与目标实体存在（无锁快读）
    const pre = await readDuanjuProject(id);
    const entity404 =
      input.kind === 'character'
        ? '角色不存在'
        : input.kind === 'scene'
          ? '场景不存在'
          : '镜头不存在';
    const exists =
      input.kind === 'character'
        ? pre.characters.some((c) => c.id === input.refId)
        : input.kind === 'scene'
          ? pre.scenes.some((s) => s.id === input.refId)
          : pre.shots.some((s) => s.id === input.refId);
    if (!exists) throw new HttpError(404, entity404);
    // ② 参考图解析：character=显式 refImageId 或主参考图；shot/frame=出场首角色的主参考图（多角色余下靠文字锚点）
    let subjectRefPath: string | undefined;
    if (input.kind === 'character') {
      const char = pre.characters.find((c) => c.id === input.refId);
      const wantRef = input.refImageId ?? char?.refImageId ?? null;
      if (wantRef) subjectRefPath = (await resolveRefPath(id, input.refId, wantRef)) ?? undefined;
    } else if (input.kind === 'shot' || input.kind === 'frame') {
      const shot = pre.shots.find((s) => s.id === input.refId);
      const firstChar = shot?.characterIds
        .map((cid) => pre.characters.find((c) => c.id === cid))
        .find((c) => c?.refImageId);
      if (firstChar?.refImageId) {
        subjectRefPath =
          (await resolveRefPath(id, firstChar.id, firstChar.refImageId)) ?? undefined;
      }
    }
    // ③ 慢操作：上游生成 + 转存（无锁，15-30s）
    const [url] = await callImageGeneration({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      subjectRefPath,
      provider: input.provider,
    });
    const stored = await downloadAndStore(id, url);
    // ④ 持锁写回
    const image: StoredImage = {
      id: `img-${randomUUID().slice(0, 8)}`,
      path: stored.path,
      prompt: input.prompt,
      createdAt: Date.now(),
      originUrl: stored.originUrl,
    };
    const project = await attachImage(id, input.kind, input.refId, image, input.frameIndex);
    res.json({ image, project });
  } catch (err) {
    if (err instanceof ImageError) {
      res.status(502).json({ code: err.code, message: err.message });
      return;
    }
    next(err);
  }
};

// ---------- GET：产物文件流 ----------

/** 允许的产物扩展名（图片 + Phase 4 视频） */
const FILE_RE = /^[\w-]+\.(png|jpg|jpeg|webp|mp4|webm)$/;

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export const serveDuanjuFile: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    assertSafeId(id);
    const name = req.params.name;
    if (!FILE_RE.test(name)) throw new HttpError(404, '文件不存在');
    // 按扩展名路由子目录（图片→images；视频→videos，T4.1）
    const ext = name.split('.').pop() ?? '';
    const sub = ext === 'mp4' || ext === 'webm' ? 'videos' : 'images';
    const baseDir = join(worksDir(), id, 'duanju', sub);
    const file = resolve(baseDir, name);
    // resolve 后必须仍落在该子目录内（防 ../ 穿越的第二道保险）
    if (!file.startsWith(baseDir)) throw new HttpError(404, '文件不存在');
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404, '文件不存在');
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(info.size));
    // 视频播放需要 Range（206 分段）；图片直接 200 全量
    const range = req.headers.range;
    if (range && ext === 'mp4') {
      const m = range.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const start = Number(m[1]);
        const end = Math.min(m[2] ? Number(m[2]) : info.size - 1, info.size - 1);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        res.setHeader('Accept-Ranges', 'bytes');
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }
    createReadStream(file).pipe(res);
  } catch (err) {
    next(err);
  }
};

// ---------- POST：外部生图回流（豆包/即梦 web 免费生成后上传归档） ----------

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const IMAGE_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export const uploadDuanjuImage: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    assertSafeId(id);
    const file = req.file;
    const kind = String(req.body?.kind ?? '') as 'character' | 'scene' | 'frame';
    const refId = String(req.body?.refId ?? '');
    const source = String(req.body?.source ?? '');
    const prompt = String(req.body?.prompt ?? '') || '(外部生图上传)';
    const frameIndexRaw = Number(req.body?.frameIndex ?? 0);
    const frameIndex = Number.isInteger(frameIndexRaw) && frameIndexRaw >= 1 && frameIndexRaw <= 4 ? frameIndexRaw : undefined;
    if (!file) throw new HttpError(400, '请上传图片文件（multipart 字段 file + kind + refId）');
    const ext = IMAGE_MIME[file.mimetype];
    if (!ext) throw new HttpError(400, `不支持的图片类型 ${file.mimetype}（支持 png/jpg/webp）`);
    if (file.size < 1024) throw new HttpError(400, '图片内容异常（过小）');
    if (kind !== 'character' && kind !== 'scene' && kind !== 'frame') {
      throw new HttpError(400, 'kind 须为 character / scene / frame');
    }
    if (kind === 'frame' && !frameIndex) throw new HttpError(400, 'kind=frame 时 frameIndex 必填（1-4）');

    const dir = workImagesDir(id);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${ext}`;
    await writeFile(join(dir, name), file.buffer);
    const image: StoredImage = {
      id: `img-${randomUUID().slice(0, 8)}`,
      path: `duanju/images/${name}`,
      prompt,
      createdAt: Date.now(),
    };
    // source=comfy（本地免费生图）→ 记账备注标注「本地免费」，成本仪表盘豁免估算
    const spendNote = source === 'comfy' ? `本地免费${frameIndex ? ` frame-${frameIndex}` : ''}` : undefined;
    const project = await attachImage(id, kind, refId, image, frameIndex, spendNote);
    res.status(201).json({ image, project });
  } catch (err) {
    next(err);
  }
};

export function mountDuanjuImages(router: import('express').Router): void {
  router.post('/works/:id/duanju/images', zodBody(genSchema), wrap(generateDuanjuImage));
  router.post('/works/:id/duanju/images/upload', uploadImage.single('file'), wrap(uploadDuanjuImage));
  router.get('/works/:id/duanju/files/:name', wrap(serveDuanjuFile));
}
