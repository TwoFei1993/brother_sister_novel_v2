/**
 * 整集成片合成（P0-3，ffmpeg 基座）：POST /works/:id/duanju/merge/:episodeId
 *
 * 镜头成品按序拼接 → 统一 1080×1890（scale+pad，试跑/终稿混拍安全）→ 响度统一 loudnorm
 * → 台词字幕烧录（ffprobe 实测时长构建 SRT 时间轴）→ 落盘 duanju/exports/ 回传下载地址。
 * ffmpeg 依赖系统安装（dev 本机 winget 版）；未安装返回 500 提示。
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import type { RequestHandler } from 'express';

import { HttpError } from '../../middleware/validate';
import { logger } from '../../middleware/logger';
import { synthesizeMinimaxAudio } from '../tts';
import { assertSafeId, worksDir, wrap } from '../works/works';
import { readDuanjuProject } from './project';

const run = promisify(execFile);
const FFMPEG_TIMEOUT = 10 * 60 * 1000;

/** ffprobe 实测单条视频时长秒（失败回退镜头 durationSec） */
async function probeDuration(file: string, fallbackSec: number): Promise<number> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 15000 });
    return Number.parseFloat(stdout.trim()) || fallbackSec;
  } catch {
    return fallbackSec;
  }
}

const srtTime = (sec: number): string => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
};

/** 有台词镜头 → SRT 块（时间轴按实测片长累计；台词按镜头整体时长展示） */
function buildSrt(entries: Array<{ start: number; dur: number; text: string }>): string {
  return entries
    .map((e, i) => `${i + 1}\n${srtTime(e.start)} --> ${srtTime(e.start + e.dur)}\n${e.text}\n`)
    .join('\n');
}

export const mergeDuanjuEpisode: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    assertSafeId(id);
    const project = await readDuanjuProject(id);
    const episode = project.episodes.find((e) => e.id === req.params.episodeId);
    if (!episode) throw new HttpError(404, '集不存在');
    const shots = project.shots
      .filter((s) => s.episodeId === episode.id && s.finalVideo)
      .sort((a, b) => a.index - b.index);
    if (shots.length === 0) throw new HttpError(400, '本集尚无成品视频——先生成或上传镜头成品');

    // 探测 ffmpeg（容器/裸机未装时给出可操作提示）
    try {
      await run('ffmpeg', ['-version'], { timeout: 8000 });
    } catch {
      throw new HttpError(500, '服务器未安装 ffmpeg——成片合成需要 ffmpeg（本机: winget install Gyan.FFmpeg；docker: 镜像内 apt 装）');
    }

    // 工作目录：系统临时目录（SRT/concat 清单用相对路径，绕开 Windows filter 路径转义坑）
    const tmpDir = join(tmpdir(), `duanju-merge-${req.params.episodeId}`);
    await mkdir(tmpDir, { recursive: true });

    const files: string[] = [];
    const srtEntries: Array<{ start: number; dur: number; text: string }> = [];
    const ttsSegs: Array<{ start: number; dur: number; text: string; voiceId: string }> = [];
    let cursor = 0;
    for (const shot of shots) {
      const abs = join(worksDir(), id, shot.finalVideo!.path);
      if (!existsSync(abs)) continue;
      files.push(`file '${abs.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
      const dur = await probeDuration(abs, shot.durationSec ?? 5);
      if (shot.dialog.trim()) {
        srtEntries.push({ start: cursor, dur, text: shot.dialog.trim() });
        // TTS 配音段：台词镜头 + 出场角色恰 1 个且配了音色（音色跨镜头一致——H3 <d> 直出的音色随机）
        const speaker = shot.characterIds
          .map((cid) => project.characters.find((c) => c.id === cid))
          .find((c) => c && c.voiceId);
        if (shot.characterIds.length <= 1 && speaker?.voiceId) {
          ttsSegs.push({ start: cursor, dur, text: shot.dialog.trim(), voiceId: speaker.voiceId });
        }
      }
      cursor += dur;
    }
    if (files.length === 0) throw new HttpError(400, '成品视频文件均不存在（可能已被清理）');

    const listFile = join(tmpDir, 'concat.txt');
    await writeFile(listFile, files.join('\n'), 'utf-8');
    const srtFile = join(tmpDir, 'subs.srt');
    await writeFile(srtFile, buildSrt(srtEntries), 'utf-8');

    // 成片落 duanju/videos/（serveDuanjuFile 白名单 ASCII 文件名——经现有文件路由直接播放/下载）
    const outName = `merged-E${episode.index}.mp4`;
    const outFile = join(worksDir(), id, 'duanju', 'videos', outName);
    await mkdir(dirname(outFile), { recursive: true });
    const videoChain = [
      // 统一 1080×1890（试跑 768 与终稿 1080 混拍安全：缩放保比例 + 黑边补齐）
      'scale=1080:1890:force_original_aspect_ratio=decrease',
      'pad=1080:1890:(ow-iw)/2:(oh-ih)/2',
      ...(srtEntries.length > 0
        ? [`subtitles=filename=subs.srt:force_style='FontName=Microsoft YaHei,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,MarginV=40'`]
        : []),
    ].join(',');
    // C3 音频后处理：H3 生成音频开头常见短爆音——头尾 30ms 对称微淡入淡出
    const audioTail = 'afade=t=in:d=0.03,areverse,afade=t=in:d=0.03,areverse,loudnorm=I=-16:TP=-1.5:LRA=11';

    // TTS 配音段生成（minimax 固定音色——跨镜头一致）：失败静默跳过（H3 原声兜底）
    const ttsReady: Array<{ start: number; dur: number; tempo: number; file: string }> = [];
    for (let i = 0; i < ttsSegs.length; i += 1) {
      const seg = ttsSegs[i]!;
      try {
        const mp3 = await synthesizeMinimaxAudio(seg.text, seg.voiceId);
        const file = `tts-${i}.mp3`;
        await writeFile(join(tmpDir, file), mp3);
        const real = await probeDuration(join(tmpDir, file), seg.dur);
        // 台词溢出镜头时长：≤1.4 倍内微压速对齐；仍超硬截断（amix duration=first 已截）
        const tempo = real > seg.dur ? Math.min(real / seg.dur, 1.4) : 1;
        ttsReady.push({ start: seg.start, dur: seg.dur, tempo: Number(tempo.toFixed(3)), file });
      } catch (err) {
        logger.warn({ shot: i, msg: err instanceof Error ? err.message : 'tts fail' }, 'TTS 配音段失败——该镜用原声');
      }
    }

    let args: string[];
    if (ttsReady.length > 0) {
      // filter_complex：原声压低 0.35 做环境底 + TTS 段 adelay 定位混入（对白为主）
      const fc: string[] = [`[0:v]${videoChain}[v]`, '[0:a]volume=0.35[bg]'];
      for (let i = 0; i < ttsReady.length; i += 1) {
        const t = ttsReady[i]!;
        fc.push(
          `[${i + 1}:a]${t.tempo > 1 ? `atempo=${t.tempo},` : ''}adelay=${Math.round(t.start * 1000)}[d${i}]`,
        );
      }
      fc.push(
        `[bg]${ttsReady.map((_, i) => `[d${i}]`).join('')}amix=inputs=${ttsReady.length + 1}:duration=first:dropout_transition=0,${audioTail}[a]`,
      );
      args = [
        '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
        ...ttsReady.flatMap((t) => ['-i', t.file]),
        '-filter_complex', fc.join(';'),
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
        '-c:a', 'aac', '-b:a', '192k',
        basename(outFile),
      ];
    } else {
      args = [
        '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
        '-vf', videoChain,
        '-af', audioTail,
        '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
        '-c:a', 'aac', '-b:a', '192k',
        basename(outFile),
      ];
    }
    await run('ffmpeg', args, { cwd: tmpDir, timeout: FFMPEG_TIMEOUT, maxBuffer: 8 * 1024 * 1024 });

    const totalDur = Math.round(cursor);
    res.json({
      ok: true,
      path: `duanju/exports/${encodeURIComponent(outName)}`,
      shots: files.length,
      durationSec: totalDur,
      subtitles: srtEntries.length,
      ttsVoiced: ttsReady.length,
    });
  } catch (err) {
    next(err);
  }
};

export function mountDuanjuMerge(router: import('express').Router): void {
  router.post('/works/:id/duanju/merge/:episodeId', wrap(mergeDuanjuEpisode));
}
