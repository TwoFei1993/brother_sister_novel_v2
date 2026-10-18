/**
 * 世界书测试共享基建（worldbook.test.ts / worldbook.match.test.ts 共用）
 */
import type { TavernWorldInfoEntry } from '@shared/tavern';
import type { WorldbookAsset } from '@shared/worldbook';

import type { MacroEnv } from '../types';
import { scanWorldInfo } from '../worldbook/scan';
import type { ScanSettings } from '../worldbook/types';

/** 最小合法条目：只需 uid，其余字段按需覆盖（zod 全字段 nullish 可选） */
export function makeEntry(
  overrides: Partial<TavernWorldInfoEntry> & { uid: number },
): TavernWorldInfoEntry {
  return { ...overrides };
}

export function makeBook(id: string, entries: TavernWorldInfoEntry[]): WorldbookAsset {
  return {
    id,
    name: id,
    raw: { entries: Object.fromEntries(entries.map((e) => [String(e.uid), e])) },
  };
}

export const BASE: ScanSettings = {
  scanDepth: 4,
  caseSensitive: false,
  matchWholeWords: false,
  recursive: false,
  maxRecursionSteps: 2,
};

/** 固定随机源（probability 测试锁定行为：0.99*100=99 > 50 视为 roll 失败） */
export const RNG_STUB = () => 0.99;

/** 单书单条目快捷扫描 */
export function scanOne(
  entry: TavernWorldInfoEntry,
  texts: string[],
  overrides: Partial<ScanSettings> = {},
) {
  return scanWorldInfo({
    books: [makeBook('b1', [entry])],
    chatTexts: texts,
    settings: { ...BASE, ...overrides },
    rng: RNG_STUB,
  });
}

export function makeEnv(overrides: Partial<MacroEnv> = {}): MacroEnv {
  return {
    user: '阿明',
    char: '爱丽丝',
    scope: 'work',
    getVar: () => undefined,
    setVar: () => undefined,
    ...overrides,
  };
}
