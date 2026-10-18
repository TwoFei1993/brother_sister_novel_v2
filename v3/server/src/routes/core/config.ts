/**
 * 运行配置（设计 §6 / §3.3）：GET/PUT /api/config → data/config.json
 *
 * 内容为非敏感配置（TTS 地址、全局变量）；登录后前端从这里拉取 TTS 地址，
 * 实现前端零硬编码后端地址。GET 文件不存在时返回默认值；PUT 原子写覆盖。
 */
import { Router } from 'express';
import { z } from 'zod';

import { zodBody } from '../../middleware/validate';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { join } from 'node:path';

import { dataDir } from './paths';

/** 配置 schema：ttsBaseUrl 必须是合法 URL；globalVariables 键值自由（模板引擎消费） */
export const configSchema = z.object({
  ttsBaseUrl: z.string().url('必须是合法 URL').optional(),
  globalVariables: z.record(z.unknown()).optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

/** GET 兜底默认值：每次新建，避免调用方持有共享引用后互相污染 */
function defaultConfig(): AppConfig {
  return { globalVariables: {} };
}

function configFile(): string {
  return join(dataDir(), 'config.json');
}

export const configRouter = Router();

configRouter.get('/', async (_req, res) => {
  const config = await readJson<AppConfig>(configFile());
  res.json(config ?? defaultConfig());
});

configRouter.put('/', zodBody(configSchema), async (req, res) => {
  await writeJsonAtomic(configFile(), req.body as AppConfig);
  res.json({ ok: true });
});
