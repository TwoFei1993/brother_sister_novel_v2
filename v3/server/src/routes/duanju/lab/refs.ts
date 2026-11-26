/**
 * 试验台参考图（M2）：上传接口与参考图文件的生老病死。
 *
 * 参考图与试验图同目录（duanju/images/），文件名带 labref- 前缀：
 * - 预览复用现有文件流路由，不用再开一条；
 * - 路径只认这个前缀（shared 的 LAB_REF_PATH_RE），服务端读盘前不信任何别的路径；
 * - 孤儿按前缀识别（资产库按「<名>-特写|三视图|场景」扫描作品图，不会误收）。
 *
 * 生命周期：添加即上传 → 出图归档时被记录引用 → 最后一个引用它的记录被删时删文件；
 * 上传后一直没出图的，在下次归档时按「超过 2 小时且无人引用」清掉。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RequestHandler } from 'express';

import { LAB_REF_MAX_BYTES, type CloudImageProvider, type LabRef, type LabRecord } from '@shared/duanju/lab';

import { HttpError } from '../../../middleware/validate';
import { workImagesDir } from '../../../services/image';
import { assertSafeId } from '../../works/works';
import { readDuanjuProject } from '../project';
import { uploadedImage } from './upload';

const LAB_REF_PREFIX = 'labref-';
const LAB_REF_DIR = 'duanju/images/';

/** 参考图路径 → 盘上绝对路径。只取文件名再拼进图片目录（路径已过前缀白名单，这里是不信任何输入的第二道） */
export function labRefFile(workId: string, path: string): string {
  return join(workImagesDir(workId), path.split('/').pop() ?? '');
}

/** POST /works/:id/duanju/lab/refs → 上传参考图，返回可写进记录的路径 */
export const uploadLabRef: RequestHandler = async (req, res, next) => {
  const id = req.params.id;
  try {
    assertSafeId(id);
    // 参考图要经 VAE 与上游接口：只收 png / jpg（webp 两边都不保证能读；客户端会把作品里的 webp 转成 png）
    const { buffer, ext } = uploadedImage(req.file, '参考图', false);
    if (buffer.byteLength > LAB_REF_MAX_BYTES) throw new HttpError(400, `参考图不能超过 ${LAB_REF_MAX_BYTES / 1024 / 1024}MB`);
    await readDuanjuProject(id); // 作品必须存在：否则不在其目录下落图
    const name = `${LAB_REF_PREFIX}${randomUUID()}${ext}`;
    const dir = workImagesDir(id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), buffer);
    res.status(201).json({ path: `${LAB_REF_DIR}${name}` });
  } catch (err) {
    next(err);
  }
};

/**
 * 云端通道的参考图：GLM-Image 不支持；Seedream 收 1 张，文件必须还在（花钱之前先拦住）。
 * 返回给上游用的绝对路径；没有参考图则 undefined。
 */
export async function resolveCloudRef(
  workId: string,
  provider: CloudImageProvider,
  refs: LabRef[],
): Promise<string | undefined> {
  if (refs.length === 0) return undefined;
  if (provider === 'zhipu') throw new HttpError(400, 'GLM-Image 通道不支持参考图——去掉参考图或换通道');
  const first = refs[0]!;
  if (!(await stat(labRefFile(workId, first.path)).catch(() => null))) {
    throw new HttpError(400, '参考图文件已不存在——请重新上传');
  }
  return labRefFile(workId, first.path);
}

/** 本地回流归档时只留下盘上还在的参考图（图已经花时间生成了，不因为参考图被清理而拒绝归档） */
export async function keepExistingRefs(workId: string, refs: LabRef[]): Promise<LabRef[]> {
  const out: LabRef[] = [];
  for (const ref of refs) {
    if (await stat(labRefFile(workId, ref.path)).catch(() => null)) out.push(ref);
  }
  return out;
}

/**
 * 清理孤儿参考图：上传超过 2 小时且没有任何记录引用的。
 * 2 小时远长于一次出图（引擎 15 分钟 + 恢复续轮询 15 分钟），在途任务手里的参考图不会被误删。
 * 调用方传入的 records 必须是「本次写入之后」的全量——刚归档的记录引用的图不能被当成孤儿。
 */
export async function sweepOrphanRefs(workId: string, records: LabRecord[]): Promise<void> {
  const used = new Set(records.flatMap((r) => r.refs.map((x) => x.path.split('/').pop())));
  const dir = workImagesDir(workId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const name of names) {
    if (!name.startsWith(LAB_REF_PREFIX) || used.has(name)) continue;
    const file = join(dir, name);
    const st = await stat(file).catch(() => null);
    if (st && st.mtimeMs < cutoff) await unlink(file).catch(() => undefined);
  }
}
