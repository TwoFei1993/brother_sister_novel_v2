/**
 * 试验台画幅与尺寸（设计共识 2026-11-26 第 2.3 / 2.6 节；分辨率 2026-11-27 用户裁定：8MP 档）
 *
 * - 全通道本地出图 8MP 分镜档（与用户 H3-Image 生成管线同档；宽高为 32 的倍数）。
 *   2026-11-27 用户裁定「都升到8mp」：试验台与设定图/服装/分镜帧等既有入口一并升档。
 *   批量出图时长随之 ×4 以上（每张约 2–5 分钟），并发 2 排队不变。
 * - 云端：尺寸表在 shared（服务端透传与界面显示同源）；云端没有 4:5
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

/** 试验台 8MP 档尺寸（面积与 2016×3584 = 7.2MP 对齐，32 的倍数） */
export const LAB_SIZES = {
  portrait: { width: 2016, height: 3584 }, // 9:16
  landscape: { width: 3584, height: 2016 }, // 16:9
  square: { width: 2688, height: 2688 }, // 1:1
  tall4x5: { width: 2400, height: 3008 }, // 4:5
} as const;

/** 既有生图入口（设定图/服装/分镜帧）尺寸——2026-11-27 用户裁定：全通道升 8MP 档 */
export const COMFY_SIZES = LAB_SIZES;

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

/** 试验台画幅 → 本地尺寸（8MP 档） */
export function labSizeFor(aspect: LabAspect): ImageSize {
  switch (aspect) {
    case '9:16':
      return { ...LAB_SIZES.portrait };
    case '16:9':
      return { ...LAB_SIZES.landscape };
    case '1:1':
      return { ...LAB_SIZES.square };
    case '4:5':
      return { ...LAB_SIZES.tall4x5 };
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
