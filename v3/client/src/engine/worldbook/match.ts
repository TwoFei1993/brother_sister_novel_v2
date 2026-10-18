/**
 * 世界书键匹配（设计 §5.2 一期）
 *
 * 语义锚点：酒馆 world-info.js
 * - matchKeys(:337)：正则键优先 → transformString（caseSensitive）→ 全词边界/includes
 * - parseRegexFromString(:2901)：`/pattern/flags`，未转义内嵌斜杠视为无效 → 回退普通文本
 * - 主键判定(:4913)：substituteParams(key).trim()，替换后空串不算命中
 * - 二级键四逻辑(:4939-4975)：AND_ANY/NOT_ALL/NOT_ANY/AND_ALL
 *
 * 有意偏离：matchWholeWords 仅对纯拉丁词启用边界正则 `(?:^|\W)…(?:$|\W)`；
 * 酒馆原版对 CJK 键同样套边界正则，但 CJK 字符本身属 \W，边界形同虚设——
 * 故 CJK（及含空白/符号的键）一律 includes 匹配（等效酒馆"多词键"分支）。
 */
import type { TavernWorldInfoEntry } from '@shared/tavern';

import { substituteParams } from '../prompt/macros';
import type { MacroEnv } from '../types';
import type { ScanSettings } from './types';

/** 酒馆 world_info_logic 枚举（:33） */
export const WORLD_INFO_LOGIC = {
  AND_ANY: 0,
  NOT_ALL: 1,
  NOT_ANY: 2,
  AND_ALL: 3,
} as const;

/** 纯拉丁词（字母/数字/下划线/连字符）：可安全套 \W 边界正则 */
const LATIN_WORD_RE = /^[a-z0-9_-]+$/i;

/** 酒馆 parseRegexFromString(:2901)：`/pattern/flags` 形式且无未转义内嵌斜杠 */
const REGEX_KEY_RE = /^\/([\w\W]+?)\/([gimsuy]*)$/;

/** 正则元字符转义（边界正则构造用） */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 酒馆 parseRegexFromString(:2901)：非法格式/语法返回 null（调用方回退普通匹配） */
export function parseRegexKey(input: string): RegExp | null {
  const match = REGEX_KEY_RE.exec(input);
  if (!match) return null;
  const [, rawPattern, flags] = match;
  // 未转义的内嵌斜杠：视为无效正则（跨引擎兼容性检查，酒馆 :2913）
  if (/(^|[^\\])\//.test(rawPattern)) return null;
  const pattern = rawPattern.replace('\\/', '/');
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/** 解析条目级大小写/全词设置：null/undefined 继承全局（酒馆 `entry.x ?? global` :270/:342） */
function entryMatchOptions(entry: TavernWorldInfoEntry, settings: ScanSettings) {
  return {
    caseSensitive: entry.caseSensitive ?? settings.caseSensitive,
    matchWholeWords: entry.matchWholeWords ?? settings.matchWholeWords,
  };
}

/** 核心单键匹配（不做宏替换；酒馆 WorldInfoBuffer.matchKeys :337） */
function matchSingleKey(
  key: string,
  text: string,
  caseSensitive: boolean,
  matchWholeWords: boolean,
): boolean {
  const keyRegex = parseRegexKey(key);
  if (keyRegex) return keyRegex.test(text);

  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? key : key.toLowerCase();
  // 全词匹配且为纯拉丁单词：边界正则（酒馆 :350；多词/CJK 键走 includes）
  if (matchWholeWords && LATIN_WORD_RE.test(needle)) {
    const boundary = new RegExp(`(?:^|\\W)(${escapeRegex(needle)})(?:$|\\W)`);
    return boundary.test(haystack);
  }
  return haystack.includes(needle);
}

/** 宏替换 + trim 单键：替换后为空串不算命中（酒馆 :4915 `substituted &&`） */
function substitutedKey(rawKey: string, macroEnv: MacroEnv | undefined): string {
  const substituted = macroEnv ? substituteParams(rawKey, macroEnv) : rawKey;
  return substituted.trim();
}

/**
 * 主键数组匹配：键先过宏替换（macroEnv 提供时），任一键命中即 true。
 * 签名对齐任务约定 matchKeys(entry, text, settings[, macroEnv])。
 */
export function matchKeys(
  entry: TavernWorldInfoEntry,
  text: string,
  settings: ScanSettings,
  macroEnv?: MacroEnv,
): boolean {
  const { caseSensitive, matchWholeWords } = entryMatchOptions(entry, settings);
  return (entry.key ?? []).some((rawKey) => {
    const key = substitutedKey(rawKey, macroEnv);
    return key !== '' && matchSingleKey(key, text, caseSensitive, matchWholeWords);
  });
}

/**
 * 二级键四逻辑判定（酒馆 matchSecondaryKeys :4944-4975）。
 * @returns 通过则 true（条目激活）
 */
function matchSecondaryKeys(
  entry: TavernWorldInfoEntry,
  text: string,
  settings: ScanSettings,
  macroEnv: MacroEnv | undefined,
): boolean {
  const logic = entry.selectiveLogic ?? WORLD_INFO_LOGIC.AND_ANY;
  const { caseSensitive, matchWholeWords } = entryMatchOptions(entry, settings);

  let hasAnyMatch = false;
  let hasAllMatch = true;

  for (const rawKey of entry.keysecondary ?? []) {
    const key = substitutedKey(rawKey, macroEnv);
    const hasMatch = key !== '' && matchSingleKey(key, text, caseSensitive, matchWholeWords);

    if (hasMatch) hasAnyMatch = true;
    if (!hasMatch) hasAllMatch = false;

    // 提前退出分支（酒馆 :4955-4961 AND_ANY 命中即真 / NOT_ALL 不命中即真）
    if (logic === WORLD_INFO_LOGIC.AND_ANY && hasMatch) return true;
    if (logic === WORLD_INFO_LOGIC.NOT_ALL && !hasMatch) return true;
  }

  if (logic === WORLD_INFO_LOGIC.NOT_ANY && !hasAnyMatch) return true;
  if (logic === WORLD_INFO_LOGIC.AND_ALL && hasAllMatch) return true;
  return false;
}

/**
 * 单条目完整判定：constant 直通 + 主键匹配 + 二级键四逻辑
 * （酒馆 checkWorldInfo :4896-4985 的键匹配部分）。
 */
export function matchEntry(
  entry: TavernWorldInfoEntry,
  text: string,
  settings: ScanSettings,
  macroEnv?: MacroEnv,
): boolean {
  if (entry.constant) return true;
  if (!entry.key?.length) return false;
  if (!matchKeys(entry, text, settings, macroEnv)) return false;

  // 二级键仅在 selective 且非空时参与（酒馆 :4924 hasSecondaryKeywords）
  const hasSecondary = entry.selective && (entry.keysecondary?.length ?? 0) > 0;
  if (!hasSecondary) return true;

  return matchSecondaryKeys(entry, text, settings, macroEnv);
}
