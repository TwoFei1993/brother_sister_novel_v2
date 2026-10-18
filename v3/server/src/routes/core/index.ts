/**
 * core 路由组（设计 §6）：鉴权 + 运行配置/密钥/自检
 *
 * 鉴权边界：health 免鉴权（部署自检需在未登录时可访问）；
 * config/secrets 涉及运行配置与密钥写入，全走 authRequired。
 */
import { Router } from 'express';

import { authRequired, authRouter } from '../../middleware/auth';
import { configRouter } from './config';
import { healthHandler } from './health';
import { secretsRouter } from './secrets';

export const coreRouter = Router();

// ---- 鉴权（Task 3）----
coreRouter.use('/auth', authRouter);

// ---- 自检（Task 5，免鉴权）----
coreRouter.get('/health', healthHandler);

// ---- 运行配置与密钥（Task 5，需登录）----
coreRouter.use('/config', authRequired, configRouter);
coreRouter.use('/secrets', authRequired, secretsRouter);
