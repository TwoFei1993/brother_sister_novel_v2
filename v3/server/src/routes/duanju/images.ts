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

import { HttpError, zodBody } from '../../middleware/validate';
import { withWorkLock } from '../../middleware/writer';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { randomUUID } from 'node:crypto';
import type { DuanjuProject, StoredImage } from '@shared/duanju';
import { assertSafeId, worksDir, wrap } from '../works/works';
import { duanjuFile, readDuanjuProject } from './project';
import { ImageError, callImageGeneration, downloadAndStore } from '../../services/image';
import { workImagesDir } from '../../services/image';

// ---------- POST：生成并转存 ----------

const genSchema = z.strictObject({
  kind: z.enum(['character', 'scene', 'shot']),
  refId: z.string().min(1),
  prompt: z.string().min(1).max(1500),
  aspectRatio: z.string().optional(),
  /** 参考图（角色 sheetImage id）：生成时保持人物一致 */
  refImageId: z.string().min(1).optional(),
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

/** 持锁落图：character/scene 追加 + bump updatedAt；shot 替换 gridImage + 写 BuiltFrom 快照（stale 事实源） */
async function attachImage(
  id: string,
  kind: 'character' | 'scene' | 'shot',
  refId: string,
  image: StoredImage,
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
      shot.gridImage = image;
      // BuiltFrom 快照：以「本次生成所依据的上游态」为准（当前 project 内的真实时点）
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
      shot.updatedAt = now;
    }
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
    // ② 参考图解析：character=显式 refImageId 或主参考图；shot=出场首角色的主参考图（多角色余下靠文字锚点）
    let subjectRefPath: string | undefined;
    if (input.kind === 'character') {
      const char = pre.characters.find((c) => c.id === input.refId);
      const wantRef = input.refImageId ?? char?.refImageId ?? null;
      if (wantRef) subjectRefPath = (await resolveRefPath(id, input.refId, wantRef)) ?? undefined;
    } else if (input.kind === 'shot') {
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
    const project = await attachImage(id, input.kind, input.refId, image);
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
    const file = resolve(join(worksDir(), id, 'duanju', 'images'), name);
    // resolve 后必须仍落在 images 目录内（防 ../ 穿越的第二道保险）
    if (!file.startsWith(join(worksDir(), id, 'duanju', 'images'))) throw new HttpError(404, '文件不存在');
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404, '文件不存在');
    const ext = name.split('.').pop() ?? 'png';
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(info.size));
    // 视频播放需要 Range（206）；图片直接 200 全量
    const range = req.headers.range;
    if (range && ext === 'mp4') {
      const m = range.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : info.size - 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
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

export function mountDuanjuImages(router: import('express').Router): void {
  router.post('/works/:id/duanju/images', zodBody(genSchema), wrap(generateDuanjuImage));
  router.get('/works/:id/duanju/files/:name', wrap(serveDuanjuFile));
}
