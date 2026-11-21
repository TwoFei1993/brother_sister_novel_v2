/**
 * server 端组装资产装载（M2 Task 3.1；client 参照 client/src/hooks/generation-pipeline.ts）
 *
 * 与 client 版差异只在 IO 缝：client 走 apiFetch（HTTP），server 直读 libraryDir 的
 * JSON 文件（<id>.json，与 routes/library/crud.ts 同一存储布局）。纯逻辑
 * （effectiveAssetIds/buildItemBook/势力伪世界书构造）逐行对照 client 实现，
 * 保证组装产物逐字节等价（D5）。任一资产读取失败静默跳过（对齐 client catch(() => null)）。
 */
import { join } from 'node:path';

import type { TavernCardV2, TavernPreset, TavernRegexScript } from '@shared/tavern';
import type { CharacterAsset } from '@shared/card';
import type { PresetAsset } from '@shared/preset';
import type { FactionAsset } from '@shared/assets/faction';
import type { ItemAsset } from '@shared/assets/item';
import { describeItem } from '@shared/assets/item';
import type { WorldbookAsset } from '@shared/worldbook';
import type { Work } from '@shared/work';

import { readJson } from '../../storage/store';
import { libraryDir } from '../../routes/library/crud';

/** 组装资产集（与 client 版 AssembleAssets 同构） */
export interface AssembleAssets {
  preset: TavernPreset | null;
  cards: TavernCardV2[];
  /** 人物小传（作者手写角色生平；与 cards 同序对齐，空串=无小传） */
  bios: string[];
  worldbooks: WorldbookAsset[];
  /** 势力介绍（整块注入提示词资料区，无逐条激活语义） */
  factions: FactionAsset[];
  regexScripts: TavernRegexScript[];
}

/** 资产 id 白名单（与 crud.ts ID_PATTERN 一致；非法 id 视为不存在，杜绝路径穿越） */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * 直读单个资产文件（server 版 IO 原语）：缺失/损坏 JSON/非法 id → null。
 * readJson 对「文件存在但非法 JSON」会抛错——client 版 API 失败即静默跳过，
 * 此处 catch 对齐同一 best-effort 语义。
 */
export async function readAsset<T>(sub: string, id: string): Promise<T | null> {
  if (!ID_PATTERN.test(id)) return null;
  try {
    return await readJson<T>(join(libraryDir(sub), `${id}.json`));
  } catch {
    return null;
  }
}

/** 正则脚本壳资产（与 routes/library/regex.ts RegexAsset 同构；shared 暂无壳类型） */
interface RegexAsset {
  raw: TavernRegexScript;
}

/** 拉取作品绑定的正则脚本（生成轨装配共用；单项失败跳过不阻塞） */
export async function loadRegexScripts(work: Work): Promise<TavernRegexScript[]> {
  const list = await Promise.all(work.regexScriptIds.map((id) => readAsset<RegexAsset>('regex-scripts', id)));
  return list.filter((a): a is RegexAsset => a !== null).map((a) => a.raw);
}

/**
 * 章号感知的绑定生效集（P2.2 绑定三态，共识 D4）
 *
 * 写第 C 章时素材生效 = 初始绑定 ids ∪ bindings(active 且 fromChapter≤C)。
 * chapterIndex 缺省（全量场景）= 不做章过滤，全部生效。
 */
export function effectiveAssetIds(
  work: Work,
  kind: 'character' | 'worldbook' | 'faction' | 'item',
  chapterIndex?: number,
): string[] {
  const initial =
    kind === 'character'
      ? work.characterIds
      : kind === 'worldbook'
        ? work.worldbookIds
        : kind === 'faction'
          ? (work.factionIds ?? [])
          : (work.itemIds ?? []);
  if (chapterIndex === undefined) return initial;
  const extra = (work.bindings ?? [])
    .filter((b) => b.kind === kind && b.status === 'active' && b.fromChapter <= chapterIndex)
    .map((b) => b.assetId);
  return [...new Set([...initial, ...extra])];
}

/**
 * 物品道具伪世界书（D4「整块注入」，同势力语义）：constant 条目复用世界书引擎注入路径。
 * 描述经 describeItem 只拼非空段（质感/形状/颜色/功能/承载感情/备注）。
 */
export function buildItemBook(items: ItemAsset[]): WorldbookAsset | null {
  if (items.length === 0) return null;
  return {
    id: '__items__',
    name: '物品道具（绑定生效）',
    raw: {
      entries: Object.fromEntries(
        items.map((it, i) => [
          String(i),
          {
            uid: i,
            key: [it.name],
            content: `【物品道具：${it.name}】${describeItem(it)}`,
            constant: true,
            enabled: true,
            insertion_order: 39,
          },
        ]),
      ),
    },
  };
}

/** 并行装载作品绑定的资产；chapterIndex 给定时按绑定生效章过滤，缺省全量 */
export async function loadAssembleAssets(work: Work, chapterIndex?: number): Promise<AssembleAssets> {
  const characterIds = effectiveAssetIds(work, 'character', chapterIndex);
  const worldbookIds = effectiveAssetIds(work, 'worldbook', chapterIndex);
  const factionIds = effectiveAssetIds(work, 'faction', chapterIndex);
  const itemIds = effectiveAssetIds(work, 'item', chapterIndex);
  const [preset, cardAssets, books, factions, itemAssets, regexScripts] = await Promise.all([
    // 预设取 raw（酒馆原生格式）——与 client 版 `.then((a) => a.raw)` 同语义
    work.presetId
      ? readAsset<PresetAsset>('presets', work.presetId).then((a) => a?.raw ?? null)
      : Promise.resolve(null),
    Promise.all(characterIds.map((id) => readAsset<CharacterAsset>('characters', id))),
    Promise.all(worldbookIds.map((id) => readAsset<WorldbookAsset>('worldbooks', id))),
    Promise.all(factionIds.map((id) => readAsset<FactionAsset>('factions', id))),
    Promise.all(itemIds.map((id) => readAsset<ItemAsset>('items', id))),
    loadRegexScripts(work),
  ]);
  // 壳层人物小传随卡同序保留（读取失败的卡小传一并丢弃，序号对齐由 filter 同步完成）
  const keptCards = cardAssets.filter((a): a is CharacterAsset => a !== null);
  const cards = keptCards.map((a) => a.card);
  const bios = keptCards.map((a) => a.bio ?? '');
  const factionList = factions.filter((f): f is FactionAsset => f !== null);
  const itemList = itemAssets.filter((x): x is ItemAsset => x !== null);
  // 势力注入（D4「整块注入」）：构造成伪世界书 constant 条目，复用世界书引擎的既有注入路径
  const factionBook: WorldbookAsset | null =
    factionList.length > 0
      ? {
          id: '__factions__',
          name: '势力设定（绑定生效）',
          raw: {
            entries: Object.fromEntries(
              factionList.map((f, i) => [
                String(i),
                {
                  uid: i,
                  key: [f.name],
                  content: `【势力设定：${f.name}】${f.description}${f.relations ? `\n与其他势力的关系：${f.relations}` : ''}${f.members?.length ? `\n主要成员：${f.members.join('、')}` : ''}`,
                  constant: true,
                  enabled: true,
                  insertion_order: 40,
                },
              ]),
            ),
          },
        }
      : null;
  const itemBook = buildItemBook(itemList);
  return {
    preset,
    cards,
    bios,
    worldbooks: [
      ...books.filter((b): b is WorldbookAsset => b !== null),
      ...(factionBook ? [factionBook] : []),
      ...(itemBook ? [itemBook] : []),
    ],
    factions: factionList,
    regexScripts,
  };
}
