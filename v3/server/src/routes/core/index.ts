/**
 * core 路由组：鉴权 + 运行配置/密钥/自检（设计 §6）
 * Task 3 实现 auth；config/secrets/health 属 Task 5，挂载点已预留。
 */
import { Router } from 'express';

import { authRouter } from '../../middleware/auth';

export const coreRouter = Router();

// ---- 鉴权（Task 3）----
coreRouter.use('/auth', authRouter);

// ---- Task 5 预留 ----
// coreRouter.use('/config', configRouter);    // GET/PUT data/config.json
// coreRouter.use('/secrets', secretsRouter);  // PUT 写密钥 / GET 回掩码
// coreRouter.use('/health', healthRouter);    // GET 存储可写 + TTS/LLM 连通
