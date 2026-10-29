/**
 * 阅读书架分组测试（P2.4 → 微信读书式网格改版后纯函数层）
 * 覆盖 groupByTag：未分类殿后、中文标签序、组内 updatedAt 新→旧、空数据。
 */
import { describe, expect, it } from 'vitest';

import type { WorkSummary } from '../../../api/works';
import { groupByTag } from '../read/ReadShelf';

const work = (id: string, updatedAt: number, shelfTag?: string): WorkSummary => ({
  id,
  title: id,
  mode: 'novel',
  genre: 'hunhe',
  updatedAt,
  shelfTag,
});

describe('groupByTag（分组 + 未分类殿后）', () => {
  it('按标签分组、未分类殿后、组内 updatedAt 新→旧', () => {
    const list = [
      work('u1', 1), // 未分类
      work('x1', 2, '玄幻'),
      work('y1', 3, '都市'),
      work('x2', 4, '玄幻'),
    ];
    const groups = groupByTag(list);
    expect(groups.map(([t]) => t)).toEqual(['都市', '玄幻', '未分类']);
    expect(groups[1]![1].map((w) => w.id)).toEqual(['x2', 'x1']); // 组内 updatedAt 新→旧
  });

  it('空书架 → 空分组', () => {
    expect(groupByTag([])).toEqual([]);
  });

  it('空标签/空白标签归为未分类', () => {
    const list = [work('a', 1, '  '), work('b', 2)];
    const groups = groupByTag(list);
    expect(groups).toHaveLength(1);
    expect(groups[0]![0]).toBe('未分类');
    expect(groups[0]![1]).toHaveLength(2);
  });
});
