/**
 * 试验台参考图（M2）：按通道截取实际会用的那些、列出作品里可用的图、取图字节。
 *
 * 参考图在「添加」时即上传到作品目录（api/duanjuLab.uploadLabRef），之后各处只传路径——
 * 预览走现有文件流路由，检查点与历史记录里也只有路径。
 */
import { LAB_REF_LIMITS, LAB_REF_MAX_BYTES, type LabProvider, type LabRecord, type LabRef } from '@shared/duanju/lab';

import { duanjuFileUrl } from '../../../../api/duanju';

/** 该通道实际会用的参考图（界面列表可以比通道上限长：切到上限更小的通道时不删用户的图，只是少用） */
export function effectiveRefs(provider: LabProvider, refs: readonly LabRef[]): LabRef[] {
  return refs.slice(0, LAB_REF_LIMITS[provider]);
}

/** 还能再加几张 */
export const refSlotsLeft = (provider: LabProvider, refs: readonly LabRef[]): number =>
  Math.max(0, LAB_REF_LIMITS[provider] - refs.length);

/** 加不了参考图时的提示 */
export function refLimitMessage(provider: LabProvider): string {
  return REF_LIMIT_TEXT[provider];
}

const REF_LIMIT_TEXT: Record<LabProvider, string> = {
  comfy: '本地引擎最多 3 张参考图——先删一张再加',
  seedream: 'Seedream 只支持 1 张参考图——先删掉再加',
  zhipu: 'GLM-Image 通道不支持参考图——换到本地引擎或 Seedream',
};

/** 参考图单张大小上限（与界面文案同一个来源：shared） */
export { LAB_REF_MAX_BYTES };

/** 参考图的图片类型（服务端同此，只收这两种）：按 MIME 判，判不出再看扩展名——手机 WebView 选图时 MIME 常为空 */
export function refMimeOf(file: Pick<File, 'type' | 'name'>): 'image/png' | 'image/jpeg' | null {
  if (file.type === 'image/png' || file.type === 'image/jpeg') return file.type;
  if (/\.png$/i.test(file.name)) return 'image/png';
  if (/\.jpe?g$/i.test(file.name)) return 'image/jpeg';
  return null;
}

/** 上传前的拦截理由（通过则 null） */
export function refFileProblem(file: Pick<File, 'type' | 'name' | 'size'>): string | null {
  if (!refMimeOf(file)) return '参考图只支持 png / jpg';
  if (file.size > LAB_REF_MAX_BYTES) return '参考图不能超过 10MB';
  return null;
}

/** 可加为参考图的候选（角色设定图 / 场景图 / 历史试验图）：说明自动填好 */
export interface LabRefOption {
  /** 原图在作品内的路径 */
  path: string;
  caption: string;
  group: '角色设定图' | '场景图' | '历史试验图';
}

/** 挑候选时需要的作品信息（DuanjuProject 的结构子集） */
export interface RefProject {
  characters: ReadonlyArray<{ name: string; sheetImages: ReadonlyArray<{ path: string }> }>;
  scenes: ReadonlyArray<{ name: string; images: ReadonlyArray<{ path: string }> }>;
}

export function pickableRefs(project: RefProject | null, records: readonly LabRecord[]): LabRefOption[] {
  const out: LabRefOption[] = [];
  for (const c of project?.characters ?? []) {
    c.sheetImages.forEach((img, i) => {
      const who = c.name.trim() || '未命名角色';
      out.push({ path: img.path, caption: `角色「${who}」的设定图${c.sheetImages.length > 1 ? ` ${i + 1}` : ''}`, group: '角色设定图' });
    });
  }
  for (const s of project?.scenes ?? []) {
    s.images.forEach((img, i) => {
      const where = s.name.trim() || '未命名场景';
      out.push({ path: img.path, caption: `场景「${where}」的图${s.images.length > 1 ? ` ${i + 1}` : ''}`, group: '场景图' });
    });
  }
  for (const r of [...records].reverse()) out.push(refOptionOfRecord(r));
  return out;
}

/** 一张历史试验图 → 参考图候选（「设为参考图」与候选列表共用同一句说明） */
export function refOptionOfRecord(record: LabRecord): LabRefOption {
  return { path: record.image.path, caption: `试验图：${record.brief.slice(0, 20)}`, group: '历史试验图' };
}

/** 取作品内一张图的字节，统一成 png / jpg（本地通道送引擎前用；同源请求带 cookie）。
 *  webp 在浏览器里转成 png——两个通道都只认 png / jpg。 */
export async function fetchWorkImage(workId: string, path: string): Promise<Blob> {
  const r = await fetch(duanjuFileUrl(workId, path));
  if (!r.ok) throw new Error(`读取图片失败（HTTP ${r.status}）——请重新添加`);
  const blob = await r.blob();
  return blob.type === 'image/png' || blob.type === 'image/jpeg' ? blob : toPng(blob);
}

async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  bitmap.close();
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片转换失败——请换一张 png / jpg'))), 'image/png');
  });
}
