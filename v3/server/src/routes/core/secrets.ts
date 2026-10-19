/**
 * LLM 密钥（设计 §6 / §4.1）：PUT /api/secrets 明文落盘，GET 只回布尔掩码
 *
 * secrets.json 仅服务端可读（LLM 代理调用时需要原文）；
 * 对外任何接口都不回传明文，掩码 {openai: bool, ...} 只表示"该通道是否已配置"。
 */
import { join } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';

import { zodBody } from '../../middleware/validate';
import { readJson, writeJsonAtomic } from '../../storage/store';

import { dataDir } from './paths';

/** 三通道密钥 schema：apiKey 必填非空；三通道均可选自定义 baseUrl（兼容中转站，如 MiniMax 的 Claude 兼容端点） */
export const secretsSchema = z.object({
  openai: z
    .object({
      apiKey: z.string().min(1, 'apiKey 不能为空'),
      baseUrl: z.string().url('必须是合法 URL').optional(),
    })
    .optional(),
  gemini: z
    .object({
      apiKey: z.string().min(1, 'apiKey 不能为空'),
      baseUrl: z.string().url('必须是合法 URL').optional(),
    })
    .optional(),
  claude: z
    .object({
      apiKey: z.string().min(1, 'apiKey 不能为空'),
      baseUrl: z.string().url('必须是合法 URL').optional(),
    })
    .optional(),
});

export type Secrets = z.infer<typeof secretsSchema>;

/** 掩码形态：通道是否已配置密钥（health 与 GET 共用同一判定） */
export type SecretsMask = { openai: boolean; gemini: boolean; claude: boolean };

function secretsFile(): string {
  return join(dataDir(), 'secrets.json');
}

/** 读取密钥掩码：文件不存在或通道缺 apiKey 都算未配置（不抛错，掩码是查询语义） */
export async function readSecretsMask(): Promise<SecretsMask> {
  const secrets = await readJson<Secrets>(secretsFile());
  return {
    openai: Boolean(secrets?.openai?.apiKey),
    gemini: Boolean(secrets?.gemini?.apiKey),
    claude: Boolean(secrets?.claude?.apiKey),
  };
}

export const secretsRouter = Router();

secretsRouter.get('/', async (_req, res) => {
  res.json(await readSecretsMask());
});

secretsRouter.put('/', zodBody(secretsSchema), async (req, res) => {
  await writeJsonAtomic(secretsFile(), req.body as Secrets);
  res.json({ ok: true });
});
