/**
 * 内容形态规范块（用户需求 2026-11-24：番茄小短篇/红果短剧剧本/电影/电视剧剧本等——
 * 形态决定体量目标、结构规范与格式指令，注入每次生成；default 不注入）。
 * 独立模块的原因：文风/基调管「语言质感」，形态管「体裁与体量」——语义不同分开维护。
 */
import { formatPresetOf, type FormatType, type FormatPreset } from '@shared/work';

/** 形态规范注入块：default/未指定 → 空串 */
export function buildFormatBlock(format: FormatType | undefined): string {
  const preset = format ? formatPresetOf(format) : null;
  if (!preset) return '';
  return (
    `【内容形态：${preset.label}（硬性要求，与文风并列遵守）】\n` +
    `- 体量与结构：${preset.structureNote}\n` +
    `- 格式规范：${preset.formatNote}`
  );
}

/** 形态模板查询（UI 建书联动用：选形态自动填每章字数/章节数） */
export function formatTemplate(format: FormatType): FormatPreset | null {
  return formatPresetOf(format);
}
