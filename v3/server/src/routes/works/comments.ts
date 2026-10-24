/**
 * comments 路由（安卓 app Phase1 划线评论）：JSONL 存储 data/works/<id>/comments.jsonl
 *
 * 读：GET / 全量（单用户量级小，不做分页；总结视图一次拉全）
 * 写：POST = 按 id 幂等 upsert；DELETE /:cid = 整文件重写去除
 * 不联动 stats（评论不进章数/字数口径）。
 */
import { join } from 'node:path';
import type { RequestHandler } from 'express';
import { Router } from 'express';

import { HttpError, zodBody } from '../../middleware/validate';
import { withWorkLock } from '../../middleware/writer';
import { appendLine, readAll, rewriteAll } from '../../storage/jsonl';
import { CommentSchema, type Comment } from '@shared/comment';
import { assertSafeId, readWork, wrap, worksDir } from './works';

function commentsFile(id: string): string {
  return join(worksDir(), id, 'comments.jsonl');
}

export const listComments: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  await readWork(id); // 404 守卫
  res.json({ comments: await readAll<Comment>(commentsFile(id)) });
};

export const upsertComment: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  const comment = req.body as Comment;
  await withWorkLock(id, async () => {
    await readWork(id);
    const file = commentsFile(id);
    const all = await readAll<Comment>(file);
    const idx = all.findIndex((c) => c.id === comment.id);
    if (idx >= 0) {
      all[idx] = comment;
      await rewriteAll(file, all);
    } else {
      all.push(comment);
      await appendLine(file, comment);
    }
  });
  res.json({ ok: true });
};

export const deleteComment: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  const cid = req.params.cid;
  await withWorkLock(id, async () => {
    await readWork(id);
    const file = commentsFile(id);
    const all = await readAll<Comment>(file);
    const next = all.filter((c) => c.id !== cid);
    if (next.length === all.length) throw new HttpError(404, '评论不存在');
    await rewriteAll(file, next);
  });
  res.json({ ok: true });
};

export const commentsRouter = Router({ mergeParams: true });

commentsRouter.get('/', wrap(listComments));
commentsRouter.post('/', zodBody(CommentSchema), wrap(upsertComment));
commentsRouter.delete('/:cid', wrap(deleteComment));
