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
    let cursor = 0;
    for (const shot of shots) {
      const abs = join(worksDir(), id, shot.finalVideo!.path);
      if (!existsSync(abs)) continue;
      files.push(`file '${abs.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
      const dur = await probeDuration(abs, shot.durationSec ?? 5);
      if (shot.dialog.trim()) srtEntries.push({ start: cursor, dur, text: shot.dialog.trim() });
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
    const args = [
      '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
      '-vf', [
        // 统一 1080×1890（试跑 768 与终稿 1080 混拍安全：缩放保比例 + 黑边补齐）
        'scale=1080:1890:force_original_aspect_ratio=decrease',
        'pad=1080:1890:(ow-iw)/2:(oh-ih)/2',
        ...(srtEntries.length > 0
          ? [`subtitles=filename=subs.srt:force_style='FontName=Microsoft YaHei,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,MarginV=40'`]
          : []),
      ].join(','),
      '-af', [
        // C3 音频后处理：H3 生成音频开头常见短爆音（插件 clean_generated_audio_start 同源问题）——
        // 头尾 30ms 对称微淡入淡出（areverse 技巧），几乎不可闻但消掉爆音点击
        'afade=t=in:d=0.03',
        'areverse,afade=t=in:d=0.03,areverse',
        'loudnorm=I=-16:TP=-1.5:LRA=11', // 响度统一（各镜头环境音量差异抹平）
      ].join(','),
      '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
      '-c:a', 'aac', '-b:a', '192k',
      basename(outFile),
    ];
    await run('ffmpeg', args, { cwd: tmpDir, timeout: FFMPEG_TIMEOUT, maxBuffer: 8 * 1024 * 1024 });

    const totalDur = Math.round(cursor);
    res.json({
      ok: true,
      path: `duanju/exports/${encodeURIComponent(outName)}`,
      shots: files.length,
      durationSec: totalDur,
      subtitles: srtEntries.length,
    });
  } catch (err) {
    next(err);
  }
};

export function mountDuanjuMerge(router: import('express').Router): void {
  router.post('/works/:id/duanju/merge/:episodeId', wrap(mergeDuanjuEpisode));
}
