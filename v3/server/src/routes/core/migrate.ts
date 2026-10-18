/**
 * 旧站数据迁移路由（设计 Task 31）：POST /api/migrate/novel-history
 *
 * body = 旧站 NovelProject[] 裸数组（{projects} 包装由客户端归一化后提交）；
 * zod 宽松 passthrough 校验，最小必填 title/chapters——深层字段由
 * services/migrate 的 strict parse 兜底，脏数据返回 400 人话消息。
 * 落盘（设计 §4.5）：逐作品持 withWorkLock 写 work.json + messages.jsonl，
 * 与 works/messages 路由共用同一把 per-work 锁。
 */
import { join } from 'node:path';
import { Router } from 'express';
import { ZodError } from 'zod';
import { z } from 'zod';

import { HttpError, zodBody } from '../../middleware/validate';
import { authRequired } from '../../middleware/auth';
import { withWorkLock } from '../../middleware/writer';
import { migrateNovelHistory, type LegacyNovelProject } from '../../services/migrate';
import { writeJsonAtomic } from '../../storage/store';
import { rewriteAll } from '../../storage/jsonl';
import { worksDir } from '../works/works';

/** 宽松输入校验：passthrough 保留旧站全部字段，只锁定最小骨架 */
export const migrateBodySchema = z.array(
  z
    .object({
      title: z.string().min(1, '作品标题不能为空'),
      chapters: z.array(z.object({}).passthrough()),
    })
    .passthrough(),
);

export const migrateRouter = Router();

migrateRouter.post(
  '/migrate/novel-history',
  authRequired,
  zodBody(migrateBodySchema),
  async (req, res, next) => {
    try {
      // strict 兜底：settings 枚举非法等深层脏数据在此抛 ZodError，转 400 人话
      const { works } = migrateNovelHistory(req.body as LegacyNovelProject[]);
      const workIds: string[] = [];
      for (const { work, messages } of works) {
        await withWorkLock(work.id, async () => {
          const dir = join(worksDir(), work.id);
          await writeJsonAtomic(join(dir, 'work.json'), work);
          await rewriteAll(join(dir, 'messages.jsonl'), messages);
        });
        workIds.push(work.id);
      }
      res.json({ migrated: workIds.length, workIds });
    } catch (err) {
      if (err instanceof ZodError) {
        next(new HttpError(400, `旧数据不合法，无法迁移：${err.issues[0]?.message ?? '格式错误'}`));
        return;
      }
      next(err);
    }
  },
);
