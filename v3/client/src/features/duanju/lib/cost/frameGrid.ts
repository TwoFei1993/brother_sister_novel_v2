/**
 * 帧工具 + 四帧拼 2×2 大图（浏览器端 canvas；成本优化 A 项）
 *
 * - missingFrames / buildFrameTasks：帧号与整集批量任务组装（纯函数）
 * - composeFrameGrid / downloadFrameGrid：帧展示用 CSS grid 即可，
 *   只有「下载/喂即梦」需要一张真拼图文件——现场用 canvas 拼出 2048² PNG 下载，server 零依赖零存储。
 *   同源 <img> 不污染画布，toBlob 可直接导出。
 */
import type { GenerateImageInput } from '../../../../api/duanju';
import { buildFramePrompt } from '../prompts/prompts-storyboard';
import type { DuanjuProject, DuanjuShot } from '@shared/duanju';

/** 缺失帧号列表（无任何帧时 = 1-4 全部） */
export function missingFrames(shot: Pick<DuanjuShot, 'frames'>): number[] {
  const have = new Set((shot.frames ?? []).map((f) => f.index));
  return [1, 2, 3, 4].filter((i) => !have.has(i));
}

/** 整集批量任务组装（BatchBar 用；导出供测试）：镜头 × 缺失帧，旧整图完成态跳过 */
export function buildFrameTasks(
  shots: DuanjuShot[],
  project: DuanjuProject,
  provider?: GenerateImageInput['provider'],
): Array<{ input: GenerateImageInput; label: string }> {
  const out: Array<{ input: GenerateImageInput; label: string }> = [];
  for (const s of shots) {
    if ((s.frames?.length ?? 0) === 0 && s.gridImage) continue; // 旧整图完成态：跳过
    for (const i of missingFrames(s)) {
      out.push({
        input: {
          kind: 'frame',
          refId: s.id,
          frameIndex: i,
          prompt: buildFramePrompt(s, i, project),
          aspectRatio: '9:16', // 竖屏短剧视频规格（1080×1920 9:16），首帧图生视频免裁切
          ...(provider ? { provider } : {}),
        },
        label: `镜头 ${s.index} · F${i}`,
      });
    }
  }
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`帧图加载失败：${src}`));
    img.src = src;
  });
}

/**
 * 拼图并触发下载。frameUrls 按 F1→F4 顺序（缺帧抛错——调用方先保证四帧齐）。
 * 返回 dataUrl 供测试/预览复用。
 */
export async function composeFrameGrid(frameUrls: string[], size = 2048): Promise<string> {
  if (frameUrls.length !== 4) throw new Error('拼图需要 4 帧');
  const imgs = await Promise.all(frameUrls.map(loadImage));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 不可用');
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, size, size);
  const cell = size / 2;
  const gaps = 6; // 细分隔线（贴资料四宫格版式）
  const cells = [
    [gaps, gaps],
    [cell + gaps, gaps],
    [gaps, cell + gaps],
    [cell + gaps, cell + gaps],
  ];
  imgs.forEach((img, i) => {
    const [x, y] = cells[i];
    // cover 裁切：正方形帧填满正方形单元
    ctx.drawImage(img, x, y, cell - gaps * 2, cell - gaps * 2);
  });
  return canvas.toDataURL('image/png');
}

export async function downloadFrameGrid(
  frameUrls: string[],
  filename: string,
): Promise<void> {
  const dataUrl = await composeFrameGrid(frameUrls);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
