#!/usr/bin/env node
/**
 * mock TTS 服务（工具性质，Task 29/33 验收用）：easyvoice 假上游
 *
 * - POST /api/v1/tts/generate → {success:true, data:{audio:"/audio/mock-N.wav"}}
 *   返回相对路径（与生产 easyvoice 行为一致，顺带验证客户端 normalizeAudioUrl 拼接）
 * - GET /audio/mock-N.wav → 静音 WAV（按文本长度 0.6s 起每 10 字 +0.1s 上限 2s），
 *   播放器 onended 正常触发，可在无 easyvoice 环境验证队列/高亮/连播全链路
 * - 带 CORS 头（客户端页面跨源请求，与生产 easyvoice 行为一致）
 *
 * 用法：node scripts/mock-tts.mjs [port]   （默认 9911；设置页 TTS 地址填 http://localhost:9911）
 */
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? process.env.MOCK_TTS_PORT ?? 9911);

/** 16bit 单声道静音 WAV（缓冲区） */
function silentWav(seconds) {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * seconds);
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

/** 内存音频库：/audio/mock-N.wav → 缓冲 */
const audioLibrary = new Map();
let calls = 0;

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'POST' && (req.url ?? '').includes('/api/v1/tts/generate')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      calls += 1;
      let text = '';
      let voice = '';
      let rate = '';
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        text = String(body.text ?? '');
        voice = String(body.voice ?? '');
        rate = String(body.rate ?? '');
      } catch {
        /* 空文本兜底 */
      }
      const seconds = Math.min(2, 0.6 + Math.floor(text.length / 10) * 0.1);
      const path = `/audio/mock-${calls}.wav`;
      audioLibrary.set(path, silentWav(seconds));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { audio: path } }));
      console.log(
        `[mock-tts] #${calls} voice=${voice || '-'} rate=${rate || '-'} text=${text.slice(0, 20)}… → ${path}（${seconds.toFixed(1)}s）`,
      );
    });
    return;
  }
  const audioPath = (req.url ?? '').split('?')[0];
  if (req.method === 'GET' && audioLibrary.has(audioPath)) {
    const wav = audioLibrary.get(audioPath);
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
    res.end(wav);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, message: 'mock-tts 仅实现 POST /api/v1/tts/generate 与 GET /audio/*' }));
});

server.listen(PORT, () => {
  console.log(`[mock-tts] http://localhost:${PORT} （设置页 TTS 服务地址填本地址）`);
});
