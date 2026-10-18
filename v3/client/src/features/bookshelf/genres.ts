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
  /** 封面底色渐变（bg-gradient-to-br 配套的 from/to 类名） */
  gradient: string;
}

export const GENRE_OPTIONS: readonly GenreOption[] = [
  { value: 'chuanyue', label: '穿越重生', gradient: 'from-amber-800 to-yellow-900' },
  { value: 'scifi', label: '星际科幻', gradient: 'from-cyan-800 to-blue-900' },
  { value: 'moshi', label: '末世求生', gradient: 'from-gray-700 to-red-900' },
  { value: 'wuxian', label: '无限流', gradient: 'from-purple-800 to-indigo-900' },
  { value: 'xuanhuan', label: '玄幻修仙', gradient: 'from-indigo-800 to-amber-900' },
  { value: 'hunhe', label: '混合类型', gradient: 'from-violet-800 to-teal-900' },
  { value: 'custom', label: '自定义', gradient: 'from-slate-700 to-slate-900' },
];

const GENRE_MAP: ReadonlyMap<string, GenreOption> = new Map(
  GENRE_OPTIONS.map((opt) => [opt.value, opt]),
);

/** 未知题材（历史数据/自定义文案）兜底为"自定义"灰阶渐变 */
export function genreOption(genre: string): GenreOption {
  return GENRE_MAP.get(genre) ?? GENRE_MAP.get('custom')!;
}

export function genreLabel(genre: string): string {
  return genreOption(genre).label;
}

/** 模式标签（设计 §4.3：novel=作者指令驱动的互动小说，chat=酒馆式角色扮演） */
export const MODE_LABELS: ReadonlyMap<string, string> = new Map([
  ['novel', '互动小说'],
  ['chat', '对话写作'],
]);
