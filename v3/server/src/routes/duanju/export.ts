/**
 * 短剧整集导出（共识 D8 / 实施计划 T3.5）：GET /works/:id/duanju/export/:episodeId
 *
 * zip 流式响应：镜头表.md（镜头号/景别/运镜/站位/动作/台词/声音/视频提示词）
 * + 全部四宫格图（E{集}-S{镜头}.png，与即梦回传对应）。archiver 即时打包不落盘。
 */
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from 'express';

import { ZipArchive } from 'archiver';

import { HttpError } from '../../middleware/validate';
import type { DuanjuProject, DuanjuShot } from '@shared/duanju';
import { assertSafeId, worksDir, wrap } from '../works/works';
import { readDuanjuProject } from './project';

/** markdown 转义（表格内竖线） */
const esc = (s: string): string => s.replace(/\|/g, '\\|');

function shotRow(shot: DuanjuShot, videoPrompt: string): string {
  return [
    `S${String(shot.index).padStart(2, '0')}`,
    esc(shot.shotSize),
    esc(shot.cameraMove),
    esc(shot.staging),
    esc(`${shot.actionStart} → ${shot.actionEnd}`),
    esc(shot.dialog),
    esc(shot.sound),
    esc(videoPrompt.replace(/\n/g, ' ')),
  ].join(' | ');
}

export const exportDuanjuEpisode: RequestHandler = async (req, res, next) => {
  try {
    const id = req.params.id;
    assertSafeId(id);
    const episodeId = req.params.episodeId;
    const project = await readDuanjuProject(id);
    const episode = project.episodes.find((e) => e.id === episodeId);
    if (!episode) throw new HttpError(404, '集不存在');
    const shots = project.shots
      .filter((s) => s.episodeId === episodeId)
      .sort((a, b) => a.index - b.index);

    const md = buildMarkdown(project, episode.title, episode.index, shots);

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: '打包失败' });
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`E${episode.index}-${episode.title}.zip`)}`,
    );
    archive.pipe(res);
    archive.append(md, { name: `E${episode.index}-镜头表.md` });
    for (const shot of shots) {
      if (!shot.gridImage) continue;
      const file = join(worksDir(), id, shot.gridImage.path);
      if (existsSync(file)) {
        archive.append(createReadStream(file), { name: `E${episode.index}-S${String(shot.index).padStart(2, '0')}.png` });
      }
    }
    await archive.finalize();
  } catch (err) {
    next(err);
  }
};

/** 与 client buildVideoPrompt 同构的提示词（server 侧独立实现，避免跨端 import） */
function videoPromptOf(shot: DuanjuShot, project: DuanjuProject): string {
  const chars = shot.characterIds
    .map((cid) => project.characters.find((c) => c.id === cid)?.name)
    .filter((n): n is string => !!n);
  const scene = project.scenes.find((s) => s.id === shot.sceneId)?.name;
  return [
    '以四宫格参考图依次生成视频（图生视频，画板顺序即时间顺序）',
    `人物：${chars.join('、') || '（按图）'}；场景：${scene ?? '按图'}`,
    `景别：${shot.shotSize}；运镜：${shot.cameraMove}；站位：${shot.staging}`,
    `动作：从「${shot.actionStart}」到「${shot.actionEnd}」，动作自然衔接`,
    shot.dialog ? `对白：「${shot.dialog}」` : '无对白',
    `声音：${shot.sound || '环境音与动作声，无背景音乐'}`,
    `画风：${project.style}，与参考图保持一致`,
  ].join('\n');
}

function buildMarkdown(project: DuanjuProject, title: string, index: number, shots: DuanjuShot[]): string {
  const lines: string[] = [
    `# 第 ${index} 集《${title}》镜头表`,
    '',
    `> 项目：${project.style} · 生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '| 镜头 | 景别 | 运镜 | 站位 | 动作 | 台词 | 声音 | 即梦提示词 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const shot of shots) lines.push(`| ${shotRow(shot, videoPromptOf(shot, project))} |`);
  lines.push('', '## 即梦操作步骤', '');
  lines.push('1. 打开即梦（jimeng.jianying.com）→ 图片生视频');
  lines.push('2. 上传本包 E-S 编号的四宫格图，粘贴对应行提示词');
  lines.push('3. 生成后导出视频，回 App 镜头卡「上传成品」归档');
  return lines.join('\n');
}

export function mountDuanjuExport(router: import('express').Router): void {
  router.get('/works/:id/duanju/export/:episodeId', wrap(exportDuanjuEpisode));
}
