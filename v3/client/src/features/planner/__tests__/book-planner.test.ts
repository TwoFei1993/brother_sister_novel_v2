/**
 * 书内策划协议层测试（纯函数）：proposalToSlice 资料切片（缺 index 回归 / base 兜底 / 正常路径）
 */
import { describe, expect, it } from 'vitest';

import { proposalToSlice, type AppliedVersion } from '../book-planner';
import type { PlannerProposal } from '../planner-llm';

function proposal(chapters: PlannerProposal['extracted']['chapters']): PlannerProposal {
  return {
    title: '末世净火',
    genre: '末世',
    extracted: {
      characters: [{ name: '苏檀', role: '妹妹', traits: [] }],
      background: '废土背景',
      abilities: [],
      factions: ['铁旗'],
      conflict: '净化异能是解药还是诱饵',
      ...(chapters ? { chapters } : {}),
    },
  };
}

describe('proposalToSlice（缺 index → NaN → null 被服务端拒的回归）', () => {
  it('条目缺 index / index 非法 → 按数组序补正整数，desiredChapterCount 保证有限正整数', () => {
    const slice = proposalToSlice(
      proposal([
        { index: undefined, title: '第一卷 起步', plot: '卷规划' },
        { index: 4, title: '第4章', plot: '细纲' },
        { index: NaN, title: '坏条目', plot: 'p' },
      ] as unknown as PlannerProposal['extracted']['chapters']),
      { desiredChapterCount: 50 },
    );
    expect(slice.chapterOutlines.map((c) => c.index)).toEqual([1, 4, 3]);
    expect(Number.isInteger(slice.desiredChapterCount)).toBe(true);
    expect(slice.desiredChapterCount).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(JSON.stringify(slice)).desiredChapterCount).not.toBeNull();
  });

  it('base.desiredChapterCount 异常（null/NaN，localStorage 旧数据）→ 不污染结果', () => {
    const slice = proposalToSlice(proposal([{ index: 3, title: '第3章', plot: 'p' }]), {
      desiredChapterCount: Number.NaN,
    });
    expect(slice.desiredChapterCount).toBe(3);
  });

  it('无章节大纲 → desiredChapterCount 兜底 1；切片字段齐全可回滚', () => {
    const slice = proposalToSlice(proposal(undefined), { desiredChapterCount: 0 });
    expect(slice.chapterOutlines).toEqual([]);
    expect(slice.desiredChapterCount).toBe(1);
    expect(slice.backgroundNote).toBe('废土背景');
    expect(slice.factions).toBe('铁旗');
  });

  it('正常路径：目标章数 = max(最大章号, base)（AppliedVersion.slice 形状兼容）', () => {
    const slice: AppliedVersion['slice'] = proposalToSlice(
      proposal([
        { index: 2, title: 'a', plot: 'pa' },
        { index: 5, title: 'b', plot: 'pb' },
      ]),
      { desiredChapterCount: 12 },
    );
    expect(slice.desiredChapterCount).toBe(12);
    expect(slice.chapterOutlines).toEqual([
      { index: 2, title: 'a', plot: 'pa' },
      { index: 5, title: 'b', plot: 'pb' },
    ]);
  });
});
