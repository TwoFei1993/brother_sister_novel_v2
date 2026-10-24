/**
 * P2.2 绑定三态 + 待绑定检测测试（深度测试 7 例）
 *
 * 覆盖：
 * 1-3. parseNewAssets：块剥离+解析 / 空块 / 坏 JSON 容错
 * 4. filterKnown：已知名过滤（包含匹配）
 * 5-7. effectiveAssetIds：初始绑定全量 / 章号过滤（fromChapter≤C）/ pending 不生效
 */
import { describe, expect, it } from 'vitest';

import type { DetectedAsset } from '@shared/message';
import type { Work } from '@shared/work';
import { defaultNovelSettings } from '@shared/work';

import { filterKnown, parseNewAssets } from '../../engine/prompt/novel/new-assets';
import { effectiveAssetIds } from '../generation-pipeline';

const workFixture = (overrides: Partial<Work> = {}): Work => ({
  id: 'w1',
  revision: 1,
  title: '测',
  mode: 'novel',
  genre: 'xuanhuan',
  characterIds: ['c1'],
  worldbookIds: ['wb1'],
  factionIds: ['f1'],
  presetId: '',
  regexScriptIds: [],
  settings: defaultNovelSettings,
  voiceMap: {},
  bindings: [
    { assetId: 'c2', kind: 'character', fromChapter: 3, status: 'active', note: '第3章起' },
    { assetId: 'c3', kind: 'character', fromChapter: 5, status: 'pending' },
    { assetId: 'wb2', kind: 'worldbook', fromChapter: 2, status: 'active' },
    { assetId: 'f2', kind: 'faction', fromChapter: 4, status: 'active' },
  ],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('parseNewAssets（side-channel 剥离与解析）', () => {
  it('正文+块：剥离块、三类清单解析、同名去重', () => {
    const raw =
      '第一章正文。\n\n苏幕抬头。\n\n<new_assets>{"characters":[{"name":"苏幕","summary":"男主"},{"name":"苏幕","summary":"重复"}],"factions":[{"name":"星盟","summary":"星际势力"}],"worldviews":[{"name":"灵网","summary":"修炼网络"}]}</new_assets>';
    const { content, detected } = parseNewAssets(raw);
    expect(content).toBe('第一章正文。\n\n苏幕抬头。');
    expect(detected).toHaveLength(3); // 同名 character 去重
    expect(detected.map((d) => d.name)).toEqual(['苏幕', '星盟', '灵网']);
    expect(detected[0]).toMatchObject({ kind: 'character', summary: '男主' });
  });

  it('空块：正文保留、清单为空', () => {
    const { content, detected } = parseNewAssets('正文而已。\n\n<new_assets></new_assets>');
    expect(content).toBe('正文而已。');
    expect(detected).toEqual([]);
  });

  it('坏 JSON：正文仍剥块、清单空（容错不崩）', () => {
    const { content, detected } = parseNewAssets('正文。<new_assets>{{{not json</new_assets>');
    expect(content).toBe('正文。');
    expect(detected).toEqual([]);
  });
});

describe('filterKnown（已知名过滤）', () => {
  it('已知角色名（含子串匹配）被剔除，新名保留', () => {
    const detected: DetectedAsset[] = [
      { kind: 'character', name: '苏幕', summary: '' },
      { kind: 'character', name: '苏幕的师父', summary: '' }, // 含已知名「苏幕」→ 剔除
      { kind: 'faction', name: '青云宗', summary: '' },
    ];
    expect(filterKnown(detected, ['苏幕', '星盟']).map((d) => d.name)).toEqual(['青云宗']);
  });
});

describe('effectiveAssetIds（绑定三态生效集）', () => {
  it('chapterIndex 缺省=全量初始绑定（chat 场景不含增量）', () => {
    expect(effectiveAssetIds(workFixture(), 'character')).toEqual(['c1']);
  });

  it('写第 3 章：fromChapter≤3 的 active 绑定并入（c2 入列），pending(c3) 不生效', () => {
    expect(effectiveAssetIds(workFixture(), 'character', 3)).toEqual(['c1', 'c2']);
  });

  it('写第 2 章：角色仍只有初始；世界书已含 wb2（fromChapter=2 当章即生效）', () => {
    expect(effectiveAssetIds(workFixture(), 'character', 2)).toEqual(['c1']);
    expect(effectiveAssetIds(workFixture(), 'worldbook', 2)).toEqual(['wb1', 'wb2']);
    expect(effectiveAssetIds(workFixture(), 'faction', 4)).toEqual(['f1', 'f2']);
  });
});
