/**
 * 短剧成品视频回传（共识 D10 / 实施计划 T4.1）：
 * POST /works/:id/duanju/videos（multipart 字段 file + shotId）
 *
 * multer 内存存储 → 校验 mp4/webm ≤100MB → 落盘 duanju/videos/{uuid}.mp4 →
 * 持锁更新 shot.finalVideo。播放走已有 files 路由（mp4 Range 206 已支持）。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { HttpError } from '../../middleware/validate';
import { withWorkLock } from '../../middleware/writer';
import { readJson, writeJsonAtomic } from '../../storage/store';
import type { DuanjuProject } from '@shared/duanju';
import { assertSafeId, worksDir, wrap } from '../works/works';
import { duanjuFile } from './project';

/** 100MB 上限（multer 全局 50mb JSON 限制不覆盖 multipart；此处独立约束） */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const ALLOWED: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mp4', // iOS 录制 mov 容器按 mp4 存（浏览器普遍可播）
};

const shotIdSchema = z.string().min(1);

function videosDir(workId: string): string {
  return join(worksDir(), workId, 'duanju', 'videos');
}

export const uploadDuanjuVideo: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    assertSafeId(id);
    const file = req.file;
    const shotId = shotIdSchema.parse(req.body?.shotId ?? '');
    if (!file) throw new HttpError(400, '请上传视频文件（multipart 字段 file + shotId）');
    const ext = ALLOWED[file.mimetype];
    if (!ext) throw new HttpError(400, `不支持的视频类型 ${file.mimetype}（支持 mp4/webm）`);
    if (file.size < 1024) throw new HttpError(400, '视频内容异常（过小）');

    // 落盘（视频目录独立于 images；files 路由扩展名白名单已含 mp4/webm）
    const dir = videosDir(id);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${ext}`;
    await writeFile(join(dir, name), file.buffer);

    const path = `duanju/videos/${name}`;
    const project = await withWorkLock(id, async (): Promise<DuanjuProject> => {
      const cur = await readJson<DuanjuProject>(duanjuFile(id));
      if (!cur) throw new HttpError(404, '短剧项目不存在');
      const shot = cur.shots.find((s) => s.id === shotId);
      if (!shot) throw new HttpError(404, '镜头不存在');
      shot.finalVideo = { path, uploadedAt: Date.now() };
      shot.updatedAt = Date.now();
      cur.updatedAt = Date.now();
      cur.revision += 1;
      await writeJsonAtomic(duanjuFile(id), cur);
      return cur;
    });
    res.status(201).json({ path, project });
  } catch (err) {
    next(err);
  }
};

export function mountDuanjuVideos(router: Router): void {
  router.post('/works/:id/duanju/videos', upload.single('file'), wrap(uploadDuanjuVideo));
}
