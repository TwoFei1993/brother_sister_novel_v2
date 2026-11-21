/**
 * 风格→预设匹配纯函数（M1 抽取自 StylePresetSection，设计共识 D2/D3）：
 * - 关键词构造：题材 + 基调拆词 + 风格中文标签拆词
 * - 匹配：tag 与预设名称双向子串包含（「欢乐」命中名称「番茄欢乐」）
 * - 理由：命中的 tag/名称列表（确认弹窗展示「命中：××」）
 * - 分组：通用（常驻）/ 匹配推荐 / 其余
 */
import { WRITING_STYLE_LABELS, type WritingStyle } from '@shared/work';

export interface PresetLite {
  id: string;
  name: string;
  tags?: string[];
}

/** 预设 tag/名称 ↔ 书风格关键词 匹配（双向包含，如 tag「治愈」匹配基调「温情治愈」） */
export function tagMatches(tag: string, keywords: string[]): boolean {
  return keywords.some((k) => k && tag && (tag.includes(k) || k.includes(tag)));
}

/** 书风格关键词：题材 + 各基调 + 自定义基调（与引擎层 tones 合并语义一致）按「·」/空白/「、」拆词 + 风格中文标签拆词（过滤空串与「—」） */
export function buildStyleKeywords(
  subGenre: string,
  storyTones: string[],
  writingStyle: WritingStyle,
  customStoryTone = '',
): string[] {
  return [subGenre, ...storyTones, customStoryTone, WRITING_STYLE_LABELS[writingStyle]]
    .flatMap((k) => (k ?? '').split(/[·\s、]/))
    .map((k) => k.trim())
    .filter((k) => k && k !== '—');
}

/**
 * 匹配理由（D3：确认弹窗展示推荐依据）：
 * - tag 命中（「通用」除外——通用走常驻分组不算推荐理由）
 * - 名称命中（前缀「名称:」）
 */
export function matchReasons(name: string, tags: string[], keywords: string[]): string[] {
  const reasons: string[] = [];
  for (const tag of tags) {
    if (tag !== '通用' && tagMatches(tag, keywords)) reasons.push(tag);
  }
  if (tagMatches(name, keywords)) reasons.push(`名称:${name}`);
  return [...new Set(reasons)];
}

/** 预设三分组（D3 确认弹窗结构） */
export interface PresetGroups {
  general: PresetLite[];
  matched: PresetLite[];
  others: PresetLite[];
}

export function groupPresets(presets: PresetLite[], keywords: string[]): PresetGroups {
  const general: PresetLite[] = [];
  const matched: PresetLite[] = [];
  const others: PresetLite[] = [];
  for (const p of presets) {
    const tags = p.tags ?? [];
    if (tags.includes('通用')) general.push(p);
    else if (matchReasons(p.name, tags, keywords).length > 0) matched.push(p);
    else others.push(p);
  }
  return { general, matched, others };
}
