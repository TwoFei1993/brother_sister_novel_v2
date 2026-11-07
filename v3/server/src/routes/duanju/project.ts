/**
 * 短剧项目路由（共识 D2 / 实施计划 T1.3）
 *
 * GET  /works/:id/duanju        → 全量 project.json（不存在抛 404）
 * PATCH /works/:id/duanju       → 乐观锁更新（revision 不符 409，语义与 work.json 同款）
 *
 * 存储：data/works/<id>/duanju/project.json；写操作走 withWorkLock（与 work.json
 * 共用 per-work 写队列）。挂载在 worksRouter（自带 authRequired；写操作另经
 * app.ts 非 GET → requireAuthor，作者专属）。
 */
import { join } from 'node:path';

import type { RequestHandler } from 'express';
import { z } from 'zod';

import { HttpError, zodBody } from '../../middleware/validate';
import { withWorkLock } from '../../middleware/writer';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { DuanjuPatchSchema, type DuanjuProject } from '@shared/duanju';
import { assertSafeId, worksDir, wrap } from '../works/works';

/** project.json 路径（图片转存目录 duanju/images/ 由 images.ts 共用） */
export function duanjuFile(workId: string): string {
  return join(worksDir(), workId, 'duanju', 'project.json');
}

export async function readDuanjuProject(workId: string): Promise<DuanjuProject> {
  const project = await readJson<DuanjuProject>(duanjuFile(workId));
  if (!project) throw new HttpError(404, '短剧项目不存在');
  return project;
}

export const getDuanjuProject: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  res.json(await readDuanjuProject(id));
};

type PatchOutcome =
  | { ok: true; project: DuanjuProject }
  | { ok: false; status: 404 | 409; message: string };

export const patchDuanjuProject: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  const input = req.body as z.infer<typeof DuanjuPatchSchema>;

  const outcome = await withWorkLock(id, async (): Promise<PatchOutcome> => {
    const current = await readJson<DuanjuProject>(duanjuFile(id));
    if (!current) return { ok: false, status: 404, message: '短剧项目不存在' };
    if (current.revision !== input.revision) {
      return {
        ok: false,
        status: 409,
        message: `版本冲突：本地 revision=${input.revision}，服务端已是 ${current.revision}，请刷新后重试`,
      };
    }
    const { revision: _rev, ...fields } = input;
    const next: DuanjuProject = {
      ...current,
      ...fields,
      revision: current.revision + 1,
      updatedAt: Date.now(),
    };
    await writeJsonAtomic(duanjuFile(id), next);
    return { ok: true, project: next };
  });

  if (!outcome.ok) throw new HttpError(outcome.status, outcome.message);
  res.json(outcome.project);
};

/** 路由装配（worksRouter 下挂 /works/:id/duanju） */
export function mountDuanjuProject(router: import('express').Router): void {
  router.get('/works/:id/duanju', wrap(getDuanjuProject));
  router.patch('/works/:id/duanju', zodBody(DuanjuPatchSchema), wrap(patchDuanjuProject));
}
