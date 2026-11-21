/**
 * 世界书扫描主流程（设计 §5.1② / §5.2 一期行为全集）
 *
 * 语义锚点：酒馆 world-info.js checkWorldInfo(:4709)：
 * 1. 常轮：constant 直通；其余条目对聊天窗口文本 matchKeys → 概率 roll
 * 2. 递归轮：新激活条目中非 preventRecursion 的 content 拼入扫描文本再扫，
 *    最多 maxRecursionSteps 轮，无新命中即停（:5080 过滤 + :5110 轮次控制）
 * 3. 位置分组：world_info_position(:855) 0before/1after/4atDepth，
 *    ANTop(2)/EMTop(5)→before、ANBottom(3)/EMBottom(6)→after（一期映射，Task 25 导入侧同步）
 * 4. 排序：order 降序（高优先在前），order 缺省 100（:4086）
 */
import type { TavernWorldInfoEntry } from '@shared/tavern';

import { matchEntry } from './match';
import type { DepthEntry, ScanInput, ScanResult, ScanSettings } from './types';

/** 酒馆 DEFAULT_DEPTH(:96) / order 默认(:4086) / role 枚举(extension_prompt_roles) */
const DEFAULT_DEPTH = 4;
const DEFAULT_ORDER = 100;
const ROLE_MAP: Record<number, DepthEntry['role']> = { 0: 'system', 1: 'user', 2: 'assistant' };

/** 带归属书的条目（activatedId 需 bookId 前缀） */
interface BookEntry {
  bookId: string;
  entry: TavernWorldInfoEntry;
}

/** 概率 roll（酒馆 verifyProbability :5028）：useProbability=false 或 100 走快路径恒过 */
function passProbability(entry: TavernWorldInfoEntry, rng: () => number): boolean {
  const probability = entry.probability ?? 100;
  if (!entry.useProbability || probability === 100) return true;
  return rng() * 100 <= probability;
}

/**
 * 条目有效扫描深度：条目级 scanDepth 非 null 用条目值，null/undefined 用全局
 * （酒馆 buffer.get :281 `entry.scanDepth ?? this.getDepth()`）。
 */
function effectiveScanDepth(entry: TavernWorldInfoEntry, settings: ScanSettings): number {
  return entry.scanDepth ?? settings.scanDepth;
}

/** 收集全部未禁用条目（多书合并；disable 跳过，酒馆 :4895） */
function collectEntries(books: ScanInput['books']): BookEntry[] {
  const result: BookEntry[] = [];
  for (const book of books) {
    for (const entry of Object.values(book.raw.entries)) {
      if (entry.disable) continue;
      result.push({ bookId: book.id, entry });
    }
  }
  return result;
}

/** 位置归一：atDepth→'depth'、after 系→'after'、其余（0/2/5）→'before' */
function positionGroup(entry: TavernWorldInfoEntry): 'before' | 'after' | 'depth' {
  // world_info_position：0 before / 1 after / 2 ANTop / 3 ANBottom / 4 atDepth / 5 EMTop / 6 EMBottom
  if (entry.position === 4) return 'depth';
  if (entry.position === 1 || entry.position === 3 || entry.position === 6) return 'after';
  return 'before';
}

/**
 * 世界书扫描主入口（纯函数）。
 * 流程：收集条目 → 常轮匹配+roll → 递归轮（可选）→ 位置分组 + order 降序输出。
 */
export function scanWorldInfo(input: ScanInput): ScanResult {
  const { books, chatTexts, settings, macroEnv } = input;
  const rng = input.rng ?? Math.random;
  const candidates = collectEntries(books);

  // 聊天窗口文本按深度缓存（条目级 scanDepth 覆盖可能取更深窗口，惰性拼接）
  const windowCache = new Map<number, string>();
  const windowText = (depth: number): string => {
    const cached = windowCache.get(depth);
    if (cached !== undefined) return cached;
    const text = chatTexts.slice(0, Math.max(0, depth)).join('\n');
    windowCache.set(depth, text);
    return text;
  };

  // 已激活集合（保序）；递归文本池：非 preventRecursion 条目的 content 逐轮累积
  const activated: BookEntry[] = [];
  const activatedIds = new Set<string>();
  const recursiveParts: string[] = [];

  const activate = (candidate: BookEntry): boolean => {
    const id = `${candidate.bookId}:${candidate.entry.uid}`;
    if (activatedIds.has(id)) return false;
    activatedIds.add(id);
    activated.push(candidate);
    if (!candidate.entry.preventRecursion) {
      const content = candidate.entry.content ?? '';
      if (content) recursiveParts.push(content);
    }
    return true;
  };

  /**
   * 单轮扫描，返回本轮新激活数。
   * 扫描池 = 条目可见聊天窗口（条目级 scanDepth 截断）+ 递归文本
   * （酒馆 buffer.get(:281) depthBuffer 截断 + recurseBuffer :318 全量附加）。
   */
  const scanRound = (recurseText: string): number => {
    let count = 0;
    for (const candidate of candidates) {
      const id = `${candidate.bookId}:${candidate.entry.uid}`;
      if (activatedIds.has(id)) continue;
      const { entry } = candidate;
      const window = windowText(effectiveScanDepth(entry, settings));
      const pool = recurseText ? `${window}\n${recurseText}` : window;
      if (!matchEntry(entry, pool, settings, macroEnv)) continue;
      // 概率 roll 在键命中之后（酒馆 :5010 顺序：匹配 → probability → 激活）
      if (!passProbability(entry, rng)) continue;
      if (activate(candidate)) count += 1;
    }
    return count;
  };

  // 常轮
  scanRound('');
  // 递归轮：非 preventRecursion 的已激活内容拼入文本再扫，限步、无新命中即停
  if (settings.recursive) {
    for (let step = 0; step < settings.maxRecursionSteps; step += 1) {
      const recurseText = recursiveParts.join('\n');
      if (!recurseText) break;
      if (scanRound(recurseText) === 0) break;
    }
  }

  // 位置分组 + 排序
  const before: string[] = [];
  const after: string[] = [];
  const depthEntries: DepthEntry[] = [];

  const byOrderDesc = (a: TavernWorldInfoEntry, b: TavernWorldInfoEntry): number =>
    (b.order ?? DEFAULT_ORDER) - (a.order ?? DEFAULT_ORDER);

  for (const group of ['before', 'after', 'depth'] as const) {
    const entries = activated
      .filter(({ entry }) => positionGroup(entry) === group)
      .map(({ entry }) => entry)
      .sort(byOrderDesc);

    for (const entry of entries) {
      const content = entry.content ?? '';
      if (group === 'before') before.push(content);
      else if (group === 'after') after.push(content);
      else {
        depthEntries.push({
          content,
          depth: entry.depth ?? DEFAULT_DEPTH,
          role: ROLE_MAP[entry.role ?? 0] ?? 'system',
          order: entry.order ?? DEFAULT_ORDER,
        });
      }
    }
  }

  // depthEntries 按 depth 降序稳定排列（同 depth 内已按 order 降序）
  depthEntries.sort((a, b) => b.depth - a.depth);

  return {
    before,
    after,
    depthEntries,
    activatedIds: activated.map(({ bookId, entry }) => `${bookId}:${entry.uid}`),
  };
}
