/**
 * 站位快览（成本优化 B 项）：staging 自由文本 → 左中右三区角色排布
 *
 * 生图前的零成本预检：肉眼检查站位逻辑，拦住必然重roll 的废图。
 * 解析规则（尽力而为，非精确舞台图）：
 * - 在角色名出现的文本位置附近（±6 字）找最近的「左/中/右」关键字归区；
 * - 「前/后/旁/中央」归中区；找不到关键字的进 unknown。
 */
import type { DuanjuCharacter } from '@shared/duanju';

export interface StagingMap {
  left: string[];
  center: string[];
  right: string[];
  unknown: string[];
}

const CENTER_WORDS = ['中', '前', '后', '旁'];

/** 方位词 → 区（左/右单字；中类词归中） */
function sideOfChar(ch: string): 'left' | 'center' | 'right' | null {
  if (ch === '左') return 'left';
  if (ch === '右') return 'right';
  if (CENTER_WORDS.includes(ch)) return 'center';
  return null;
}

/**
 * 角色名方位：**后方优先**（中文站位描述习惯「阿噗站在右侧」）——
 * 名字后 6 字内取第一个方位词；后方无则取名字前 6 字内最近的（「左侧的小满」形态）。
 */
function sideOf(text: string, name: string): 'left' | 'center' | 'right' | null {
  const at = text.indexOf(name);
  if (at < 0) return null;
  const end = at + name.length;
  for (let i = end; i < Math.min(text.length, end + 6); i++) {
    const side = sideOfChar(text[i]);
    if (side) return side;
  }
  for (let i = at - 1; i >= Math.max(0, at - 6); i--) {
    const side = sideOfChar(text[i]);
    if (side) return side;
  }
  return null;
}

export function parseStaging(staging: string, characters: DuanjuCharacter[]): StagingMap {
  const map: StagingMap = { left: [], center: [], right: [], unknown: [] };
  if (!staging.trim()) {
    map.unknown = characters.map((c) => c.name);
    return map;
  }
  for (const c of characters) {
    if (!c.name.trim()) continue;
    const side = sideOf(staging, c.name);
    map[side ?? 'unknown'].push(c.name);
  }
  return map;
}
