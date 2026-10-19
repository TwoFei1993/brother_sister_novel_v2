/**
 * library 路由组：四类资产 CRUD（设计 §6，Task 6）
 * 挂载方式（协调者在 app.ts 统一执行，本文件不改 app.ts）：
 *   app.use('/api', libraryRouter);
 * 鉴权：设计 §6 除 auth/health 外全走鉴权中间件，故组内自带 authRequired
 *（协调者若在外层再挂一次，重复校验幂等无害）。
 */
import { Router } from 'express';

import { authRequired } from '../../middleware/auth';
import { charactersRouter } from './characters';
import { worldbooksRouter } from './worldbooks';
import { presetsRouter } from './presets';
import { regexRouter } from './regex';
import { ioCardRouter } from './io/io-card';
import { ioAssetsRouter } from './io/io-assets';
import { resourcesRouter } from './io/resources';

export const libraryRouter = Router();

libraryRouter.use(authRequired);

libraryRouter.use('/characters', charactersRouter);
libraryRouter.use('/worldbooks', worldbooksRouter);
libraryRouter.use('/presets', presetsRouter);
libraryRouter.use('/regex-scripts', regexRouter);

// ---- Task 24：io-card（角色卡 PNG 导入/导出，V2/V3 转换）→ /api/io/characters/* ----
libraryRouter.use('/io', ioCardRouter);
// ---- Task 25：io-assets（世界书/预设/正则 JSON 导入/导出）→ /api/io/{worldbooks|presets|regex-scripts}/* ----
libraryRouter.use('/io', ioAssetsRouter);
// ---- Task 30：resources（资源中心：精选索引 + builtin/直链拉取导入）→ /api/io/resources/* ----
libraryRouter.use('/io/resources', resourcesRouter);
