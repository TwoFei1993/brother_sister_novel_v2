/**
 * 沟通模式·留言板路由（安卓 app Phase3 P3.2）：data/community.jsonl
 *
 * - GET /：登录即可读（读者+作者）
 * - POST /：登录即可发（留言/系统建议/想看的书）
 * - POST /:id/reply：作者回复
 * - DELETE /:cid：作者或留言本人
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { authRequired } from '../middleware/auth';
import { HttpError, zodBody } from '../middleware/validate';
import { appendLine, readAll, rewriteAll } from '../storage/jsonl';
import type { BoardEntry } from '@shared/community';
import { dataDir } from './core/paths';
import { findUserById } from '../services/users';

function boardFile(): string {
  return join(dataDir(), 'community.jsonl');
}

function requireAuth(req: { auth?: { uid: string; role: 'author' | 'reader' } }): { uid: string; role: 'author' | 'reader' } {
  if (!req.auth) throw new HttpError(401, '未登录');
  return req.auth;
}

export const listBoard: RequestHandler = async (req, res, next) => {
  try {
    requireAuth(req);
    const all = await readAll<BoardEntry>(boardFile());
    res.json({ entries: all.sort((a, b) => b.createdAt - a.createdAt) });
  } catch (err) {
    next(err);
  }
};

const postSchema = z.strictObject({
  type: z.enum(['留言', '建议', '想看']),
  text: z.string().min(1, '内容不能为空').max(2000),
});

export const postEntry: RequestHandler = async (req, res, next) => {
  try {
    const auth = requireAuth(req);
    const { type, text } = req.body as z.infer<typeof postSchema>;
    const user = await findUserById(dataDir(), auth.uid);
    const name = user?.displayName || user?.username || (auth.role === 'author' ? '作者' : '读者');
    const entry: BoardEntry = {
      id: randomUUID(),
      author: { uid: auth.uid, name },
      type,
      text,
      createdAt: Date.now(),
    };
    await appendLine(boardFile(), entry);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
};

const replySchema = z.strictObject({ text: z.string().min(1).max(2000) });

export const replyEntry: RequestHandler = async (req, res, next) => {
  try {
    const auth = requireAuth(req);
    if (auth.role !== 'author') throw new HttpError(403, '只有作者可以回复');
    const { id } = req.params;
    const { text } = req.body as z.infer<typeof replySchema>;
    const all = await readAll<BoardEntry>(boardFile());
    const idx = all.findIndex((e) => e.id === id);
    if (idx < 0) throw new HttpError(404, '留言不存在');
    all[idx] = { ...all[idx]!, reply: { name: '作者', text, at: Date.now() } };
    await rewriteAll(boardFile(), all);
    res.json(all[idx]);
  } catch (err) {
    next(err);
  }
};

export const deleteEntry: RequestHandler = async (req, res, next) => {
  try {
    const auth = requireAuth(req);
    const { id } = req.params;
    const all = await readAll<BoardEntry>(boardFile());
    const target = all.find((e) => e.id === id);
    if (!target) throw new HttpError(404, '留言不存在');
    if (auth.role !== 'author' && target.author.uid !== auth.uid) throw new HttpError(403, '只能删除自己的留言');
    await rewriteAll(boardFile(), all.filter((e) => e.id !== id));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

export const communityRouter = Router();
communityRouter.use(authRequired);
communityRouter.get('/', listBoard);
communityRouter.post('/', zodBody(postSchema), postEntry);
communityRouter.post('/:id/reply', zodBody(replySchema), replyEntry);
communityRouter.delete('/:id', deleteEntry);
