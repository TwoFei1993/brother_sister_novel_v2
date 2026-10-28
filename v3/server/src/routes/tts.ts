/**
 * TTS 合成路由（安卓 app 听书）：POST /api/tts/minimax
 *
 * body {text, voiceId}（voiceId 形如 female-shaonv）→
 * server 持 secrets key 调 MiniMax /v1/t2a_v2 → hex 音频解码 → audio/mpeg 二进制返回。
 * key 不出服务端；错误转人话 JSON。登录即可用（读者听书）。
 */
import { join } from 'node:path';

import express, { type RequestHandler } from 'express';
import { z } from 'zod';

import { authRequired } from '../middleware/auth';
import { logger } from '../middleware/logger';
import { HttpError, zodBody } from '../middleware/validate';
import { readJson } from '../storage/store';
import { dataDir } from './core/paths';

const T2A_URL = 'https://api.minimaxi.com/v1/t2a_v2';

const synthSchema = z.strictObject({
  text: z.string().min(1).max(5000),
  voiceId: z.string().min(1),
  speed: z.number().min(0.5).max(2).optional(),
});

interface SecretsFull {
  claude?: { apiKey?: string };
}

async function minimaxKey(): Promise<string> {
  const s = await readJson<SecretsFull>(join(dataDir(), 'secrets.json'));
  return s?.claude?.apiKey ?? '';
}

export const synthesizeMinimax: RequestHandler = async (req, res, next) => {
  try {
    const { text, voiceId, speed } = req.body as z.infer<typeof synthSchema>;
    const key = await minimaxKey();
    if (!key) throw new HttpError(503, '服务端未配置 MiniMax 密钥');

    // MiniMax 上游偶发 5xx/超时：自动重试一次（与生成端 generateTextOnce 兜底同哲学）
    let upstream: Response | null = null;
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(T2A_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'speech-2.8-hd',
            text,
            stream: false,
            voice_setting: { voice_id: voiceId, speed: speed ?? 1.0, vol: 1.0, pitch: 0 },
            audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
            pronunciation_dict: { tone: ['血*xuè'] },  // 官方格式：单元素字符串数组「字*拼音」
          }),
        });
        if (res.ok) { upstream = res; break; }
        lastStatus = res.status;
        logger.warn({ attempt, status: res.status }, 'MiniMax T2A 上游非 2xx');
      } catch {
        lastStatus = 0; // 网络/上游错误：重试
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
    if (!upstream) throw new HttpError(502, `MiniMax TTS 上游错误（${lastStatus}），请稍后重试`);
    const r = (await upstream.json()) as { data?: { audio?: string }; base_resp?: { status_code?: number; status_msg?: string } };
    if (r.base_resp && r.base_resp.status_code !== 0) {
      logger.error({ base: r.base_resp, textLen: text.length }, 'MiniMax T2A base_resp 非零');
      throw new HttpError(502, `MiniMax TTS 错误：${r.base_resp.status_msg ?? '未知'}（code ${r.base_resp.status_code}）`);
    }
    const audio = bytesFromHex(r.data?.audio ?? '');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(audio.length));
    res.status(200).send(audio);
  } catch (err) {
    next(err);
  }
};

function bytesFromHex(hex: string): Buffer {
  const clean = hex.length % 2 === 0 ? hex : hex.slice(0, -1);
  return Buffer.from(clean, 'hex');
}

export const ttsRouter = express.Router();

ttsRouter.use(authRequired);
ttsRouter.post('/minimax', zodBody(synthSchema), synthesizeMinimax);
