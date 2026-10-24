/**
 * 阅读书架分类与排序测试（P2.4，深度测试 5 例：纯函数层）
 * 覆盖 sortByOrder / groupByTag：手动序优先、缺位回退、未分类殿后、中文标签序、空数据。
 */
import { describe, expect, it } from 'vitest';

import type { WorkSummary } from '../../../api/works';
import { groupByTag, sortByOrder } from '../read/ReadShelf';

const work = (id: string, updatedAt: number, shelfTag?: string): WorkSummary => ({
  id,
  title: id,
  mode: 'novel',
  genre: 'hunhe',
  updatedAt,
  shelfTag,
});

describe('sortByOrder（手动序 + 缺位回退）', () => {
  it('手动 order 完全覆盖：按 order 顺序输出', () => {
    const list = [work('a', 1), work('b', 2), work('c', 3)];
    expect(sortByOrder(list, ['c', 'a', 'b']).map((w) => w.id)).toEqual(['c', 'a', 'b']);
  });

  it('order 缺位的书按 updatedAt 新→旧排在手动序之后', () => {
    const list = [work('old', 1), work('new', 99), work('pinned', 5)];
    expect(sortByOrder(list, ['pinned']).map((w) => w.id)).toEqual(['pinned', 'new', 'old']);
  });

  it('空 order：全按 updatedAt 新→旧', () => {
    const list = [work('a', 1), work('b', 50), work('c', 10)];
    expect(sortByOrder(list, []).map((w) => w.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('groupByTag（分组 + 未分类殿后）', () => {
  it('按标签分组、未分类殿后、组内按手动序', () => {
    const list = [
      work('u1', 1), // 未分类
      work('x1', 2, '玄幻'),
      work('y1', 3, '都市'),
      work('x2', 4, '玄幻'),
    ];
    const groups = groupByTag(list, []);
    expect(groups.map(([t]) => t)).toEqual(['都市', '玄幻', '未分类']);
    expect(groups[1]![1].map((w) => w.id)).toEqual(['x2', 'x1']); // 组内 updatedAt 新→旧
  });

  it('空书架 → 空分组', () => {
    expect(groupByTag([], [])).toEqual([]);
  });
});
