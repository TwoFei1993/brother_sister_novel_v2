/**
 * 自检（设计 §3.3 / §6）：GET /api/health（免鉴权）
 *
 * 三项探针：
 * - storage：data/ 可写探针（写探针文件后删除，任一步失败即 fail）
 * - tts：config.ttsBaseUrl 未设置 → unset；fetch 连通（3s 超时，任何响应都算通）→ ok；网络层失败 → down
 * - llm：各通道密钥是否已配置（掩码，与 GET /api/secrets 同一判定）
 * 部署后先看此接口即可确认环境可用（Zeabur 交付判据的一部分）。
 */
import type { RequestHandler } from 'express';

import { deleteFile, readJson, writeJsonAtomic } from '../../storage/store';
import { join } from 'node:path';

import { type AppConfig } from './config';
import { dataDir } from './paths';
import { readSecretsMask } from './secrets';

const PROBE_FILE = '.health-probe';
const TTS_TIMEOUT_MS = 3000;

/** data/ 可写探针：写入探针文件再删除；双步都成功才 ok，并保证不留垃圾文件 */
async function probeStorage(): Promise<'ok' | 'fail'> {
  try {
    await writeJsonAtomic(join(dataDir(), PROBE_FILE), { at: Date.now() });
    await deleteFile(join(dataDir(), PROBE_FILE));
    return 'ok';
  } catch {
    return 'fail';
  }
}

/** TTS 连通：3s 超时；拿到任何 HTTP 响应都算可达（状态码不代表服务内部健康） */
async function probeTts(baseUrl: string): Promise<'ok' | 'down'> {
  try {
    await fetch(baseUrl, { signal: AbortSignal.timeout(TTS_TIMEOUT_MS) });
    return 'ok';
  } catch {
    return 'down';
  }
}

export const healthHandler: RequestHandler = async (_req, res) => {
  const storage = await probeStorage();
  const ttsBaseUrl = (await readJson<AppConfig>(join(dataDir(), 'config.json')))?.ttsBaseUrl;
  const [tts, llm] = [
    ttsBaseUrl ? await probeTts(ttsBaseUrl) : 'unset',
    await readSecretsMask(),
  ];
  res.json({ storage, tts, llm });
};
