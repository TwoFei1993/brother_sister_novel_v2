/**
 * 物品道具注入测试（用户需求：物品资料卡整块注入提示词）
 * buildItemBook：伪世界书 constant 条目（同势力 D4 语义）；describeItem 只拼非空段。
 */
import { describe, expect, it } from 'vitest';
import type { ItemAsset } from '@shared/assets/item';

import { buildItemBook } from '../generation-pipeline';

const full: ItemAsset = {
  id: 'i1',
  name: '母亲的银锁',
  summary: '藏着母亲字条的旧银锁',
  texture: '温润玉质',
  shape: '拇指大小圆锁',
  color: '月白色',
  usage: '佩戴时安抚异能反噬',
  emotion: '母亲遗物',
  owner: '林晚',
};

describe('buildItemBook（物品道具 → 伪世界书注入）', () => {
  it('空列表 → null（不注入）', () => {
    expect(buildItemBook([])).toBeNull();
  });

  it('非空 → constant 条目，content 按 describeItem 拼非空段', () => {
    const book = buildItemBook([full]);
    expect(book).not.toBeNull();
    const entry = Object.values(book!.raw.entries)[0] as { key: string[]; content: string; constant: boolean };
    expect(entry.key).toEqual(['母亲的银锁']);
    expect(entry.constant).toBe(true);
    expect(entry.content).toContain('【物品道具：母亲的银锁】');
    expect(entry.content).toContain('质感：温润玉质');
    expect(entry.content).toContain('承载感情：母亲遗物');
    expect(entry.content).toContain('主人：林晚');
  });

  it('可选段留空 → 只拼非空段（不出现「质感：」空值段）', () => {
    const book = buildItemBook([{ id: 'i2', name: '星陨剑', summary: '坠星铁短剑', owner: '无' }]);
    const entry = Object.values(book!.raw.entries)[0] as { content: string };
    expect(entry.content).toBe('【物品道具：星陨剑】坠星铁短剑；主人：无');
    expect(entry.content).not.toContain('质感');
  });
});
