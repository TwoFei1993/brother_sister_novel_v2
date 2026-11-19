#!/usr/bin/env node
/**
 * A/B 配音 demo（治「台词听不懂」）：H3 <d> 直出语音含糊 → minimax TTS 清晰对白混入。
 * 与 App 成片合成（merge.ts）同参数：原声压 0.35 做环境底 + 对白 adelay 定位混入（amix）。
 *
 * 用法：node scripts/ab-tts-mix.mjs [输入.mp4] [输出.mp4] [台词] [音色id]
 * 默认：v2-6s.mp4 → v2-配音.mp4，台词「你到底隐瞒了什么！」，音色 female-chengshu（成熟女性）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { join } from 'node:path';

const run = promisify(execFile);
const [inArg, outArg, textArg, voiceArg, emotionArg] = process.argv.slice(2);
/** 情绪（MiniMax voice_setting.emotion）：happy/sad/angry/fearful/disgusted/surprised/calm——质问戏用 angry */
const EMOTION = emotionArg ?? '';
const DIR = 'D:/短剧生成/测试/ab-视频提示词v1v2对比';
const IN = inArg ?? `${DIR}/v2-6s.mp4`;
const OUT = outArg ?? IN.replace('.mp4', '-配音.mp4');
const TEXT = textArg ?? '你到底隐瞒了什么！';
const VOICE = voiceArg ?? 'female-chengshu';

const key = JSON.parse(readFileSync('data/secrets.json', 'utf8')).claude.apiKey;

// ① minimax TTS（与 server synthesizeMinimaxAudio 同请求体；hex 音频解码）
console.log(`[1/3] TTS「${TEXT}」音色 ${VOICE}…`);
const r = await fetch('https://api.minimaxi.com/v1/t2a_v2', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'speech-2.8-hd',
    text: TEXT,
    stream: false,
    voice_setting: { voice_id: VOICE, speed: 1.1, vol: 1.0, pitch: 0, ...(EMOTION ? { emotion: EMOTION } : {}) },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
  }),
  signal: AbortSignal.timeout(60_000),
});
const j = await r.json();
if (!j.data?.audio) throw new Error(`TTS 失败：${j.base_resp?.status_msg ?? JSON.stringify(j).slice(0, 200)}`);
const clean = j.data.audio.length % 2 === 0 ? j.data.audio : j.data.audio.slice(0, -1);
const ttsMp3 = join(tmpdir(), 'ab-tts.mp3');
writeFileSync(ttsMp3, Buffer.from(clean, 'hex'));

// ② 对白时长（adelay 定位用：约 1.7s 处开口——与 v3 提示词的开口停顿一致）
const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ttsMp3]);
const ttsDur = Number(stdout.trim());
console.log(`  ✓ TTS ${ttsDur.toFixed(1)}s`);

// ③ 混音（merge.ts 同款：原声压 0.35 + adelay + amix）
console.log(`[2/3] ffmpeg 混音（原声压 0.35，对白 1.7s 处进入）…`);
await run('ffmpeg', [
  '-y', '-i', IN, '-i', ttsMp3,
  '-filter_complex',
  `[0:a]volume=0.35[bg];[1:a]adelay=1700|1700,volume=1.2[vo];[bg][vo]amix=inputs=2:duration=first:dropout_transition=3[a]`,
  '-map', '0:v', '-map', '[a]',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  OUT,
], { timeout: 120_000 });
console.log(`[3/3] ✓ ${OUT}`);
