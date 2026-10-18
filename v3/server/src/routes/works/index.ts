/**
 * works 路由组装配（设计 §6）：作品 CRUD + revision 乐观锁
 *
 * 挂载方式（协调者统一在 app.ts 执行）：app.use('/api', worksRouter)
 * 本 Router 挂在 /api 下，组内路径须自带 /works 前缀（与 core 组 use('/auth') 模式一致）。
 * 所有 async handler 经 wrap 包装（Express 4 不自动捕获 async rejection）。
 */
import { Router } from 'express';

import { authRequired } from '../../middleware/auth';
import { zodBody } from '../../middleware/validate';
import {
  createWork,
  createWorkSchema,
  deleteWork,
  getWork,
  listWorks,
  updateWork,
  updateWorkSchema,
  wrap,
} from './works';

export const worksRouter = Router();

worksRouter.use(authRequired);

worksRouter.get('/works', wrap(listWorks));
worksRouter.post('/works', zodBody(createWorkSchema), wrap(createWork));
worksRouter.get('/works/:id', wrap(getWork));
worksRouter.patch('/works/:id', zodBody(updateWorkSchema), wrap(updateWork));
worksRouter.delete('/works/:id', wrap(deleteWork));

// ---- Task 8 预留：messages 子路由（JSONL 消息流，设计 §6）----
// import { messagesRouter } from './messages';
// worksRouter.use('/works/:id/messages', messagesRouter);
