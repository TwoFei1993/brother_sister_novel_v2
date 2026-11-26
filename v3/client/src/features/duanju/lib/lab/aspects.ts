/**
 * 试验台画幅与尺寸（设计共识 2026-11-26 第 2.3 / 2.6 节）
 *
 * - 本地 ComfyUI：宽高为 32 的倍数，约 2MP 以内（12GB 显存 + 32GB 内存机器的上限）
 * - 云端：尺寸表在 shared（服务端透传与界面显示同源）；云端没有 4:5
 * - comfySizeFor：既有生图入口的尺寸函数，自 api/duanju.ts 迁来与本文件共用同一组尺寸
 */
import {
  CLOUD_IMAGE_SIZES,
  type CloudImageProvider,
  type LabAspect,
  type LabProvider,
} from '@shared/duanju/lab';

export interface ImageSize {
  width: number;
  height: number;
}

/** 本地 ComfyUI 常用尺寸 */
export const COMFY_SIZES = {
  portrait: { width: 768, height: 1344 }, // 9:16 分镜帧
  landscape: { width: 1344, height: 768 }, // 16:9 设定图 / 场景图
  square: { width: 1024, height: 1024 }, // 方图（服装 / 道具）
  tall4x5: { width: 1152, height: 1440 }, // 4:5 胸像锚点
} as const;

/** 各通道支持的画幅（云端尺寸表没有 4:5） */
export const ASPECTS_BY_PROVIDER: Record<LabProvider, readonly LabAspect[]> = {
  comfy: ['9:16', '16:9', '1:1', '4:5'],
  seedream: ['9:16', '16:9', '1:1'],
  zhipu: ['9:16', '16:9', '1:1'],
};

export const LAB_PROVIDER_LABELS: Record<LabProvider, string> = {
  comfy: '本地引擎',
  seedream: 'Seedream',
  zhipu: 'GLM-Image',
};

export const ASPECT_LABELS: Record<LabAspect, string> = {
  '9:16': '竖屏 9:16',
  '16:9': '横屏 16:9',
  '1:1': '方图 1:1',
  '4:5': '竖图 4:5',
};

/** 试验台画幅 → 本地尺寸 */
export function labSizeFor(aspect: LabAspect): ImageSize {
  switch (aspect) {
    case '9:16':
      return { ...COMFY_SIZES.portrait };
    case '16:9':
      return { ...COMFY_SIZES.landscape };
    case '1:1':
      return { ...COMFY_SIZES.square };
    case '4:5':
      return { ...COMFY_SIZES.tall4x5 };
  }
}

/** 试验台画幅 → 云端尺寸（界面显示与归档记录用；服务端按同一张表透传给上游） */
export function cloudSizeFor(provider: CloudImageProvider, aspect: LabAspect): ImageSize {
  const size = CLOUD_IMAGE_SIZES[provider][aspect as keyof (typeof CLOUD_IMAGE_SIZES)[CloudImageProvider]];
  if (!size) throw new Error(`${provider} 通道不支持画幅 ${aspect}`);
  const [width, height] = size.split('x').map(Number);
  return { width: width!, height: height! };
}

/** 通道默认画幅（当前画幅不被该通道支持时回落） */
export function defaultAspectFor(provider: LabProvider): LabAspect {
  return ASPECTS_BY_PROVIDER[provider][0];
}

/** 既有生图入口的尺寸：服装/道具方图、分镜帧竖屏、其余横版；4:5 锚点图优先（'shot' 为旧整图模式，按横版） */
export function comfySizeFor(
  kind: 'character' | 'outfit' | 'scene' | 'frame' | 'prop' | 'shot',
  aspectRatio?: string,
): ImageSize {
  if (aspectRatio === '4:5') return { ...COMFY_SIZES.tall4x5 };
  if (kind === 'outfit' || kind === 'prop') return { ...COMFY_SIZES.square };
  return kind === 'frame' ? { ...COMFY_SIZES.portrait } : { ...COMFY_SIZES.landscape };
}
