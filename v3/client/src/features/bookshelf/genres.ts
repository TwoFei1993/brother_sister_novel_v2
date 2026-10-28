/**
 * 题材枚举与展示映射（WorkCard 渐变封面 / NewWorkDialog 题材选择共用）
 *
 * 枚举值从 @shared/work 的 GenreTypeSchema 派生（与 server 校验同源）；
 * 中文标签与渐变配色移植旧站 Bookshelf（设计 §7.3 保留移植资产），
 * 完整 6 套 CSS 变量主题体系（data-theme）属 Task 32，此处先用 Tailwind 渐变。
 */
import { GenreTypeSchema } from '@shared/work';

export type Genre = (typeof GenreTypeSchema.options)[number];

export interface GenreOption {
  value: Genre;
  label: string;
  /** 封面色相带：题材定带（暖=穿越、冷=科幻…），作品 id 在带内派生偏移——
   * 同题材不同书不再同色（2026-10-27 走查条目⑩），分类直觉保留 */
  hueBase: number;
  hueSpan: number;
}

export const GENRE_OPTIONS: readonly GenreOption[] = [
  { value: 'moshi', label: '末世求生', hueBase: 0, hueSpan: 25 },
  { value: 'chuanyue', label: '穿越重生', hueBase: 32, hueSpan: 38 },
  { value: 'xuanhuan', label: '玄幻修仙', hueBase: 95, hueSpan: 40 },
  { value: 'scifi', label: '星际科幻', hueBase: 180, hueSpan: 45 },
  { value: 'wuxian', label: '无限流', hueBase: 250, hueSpan: 30 },
  { value: 'hunhe', label: '混合类型', hueBase: 288, hueSpan: 47 },
  { value: 'custom', label: '自定义', hueBase: 215, hueSpan: 15 },
];

const GENRE_MAP: ReadonlyMap<string, GenreOption> = new Map(
  GENRE_OPTIONS.map((opt) => [opt.value, opt]),
);

/** 未知题材（历史数据/自定义文案）兜底为"自定义"灰阶带 */
export function genreOption(genre: string): GenreOption {
  return GENRE_MAP.get(genre) ?? GENRE_MAP.get('custom')!;
}

/** FNV-1a 短哈希：作品 id → 32 位无符号整数（仅取色用，非加密） */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 作品书皮渐变：题材色相带内按 id 派生色相，深色双停在 160° 对角（白字对比度稳定） */
export function bookSkin(genre: string, workId: string): { from: string; to: string; hue: number } {
  const { hueBase, hueSpan } = genreOption(genre);
  const hue = (hueBase + (hashId(workId) % hueSpan) + 360) % 360;
  return {
    hue,
    from: `hsl(${hue} 42% 34%)`,
    to: `hsl(${(hue + 28) % 360} 48% 18%)`,
  };
}

export function genreLabel(genre: string): string {
  return genreOption(genre).label;
}

/** 模式标签（设计 §4.3：novel=作者指令驱动的互动小说，chat=酒馆式角色扮演） */
export const MODE_LABELS: ReadonlyMap<string, string> = new Map([
  ['novel', '互动小说'],
  ['chat', '对话写作'],
]);
