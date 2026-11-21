/**
 * token 近似估算与预算装填测试（设计 §5.4 前端近似轨）
 * 锚点：与 GPT 系列 tokenizer 对中文样本的比值 ≈ 1.5 token/汉字；允许 ±15% 误差
 */
import { describe, expect, it } from 'vitest';

import { countTokensApprox, fillBudget } from '../budget';

/** 生成 n 个汉字的伪自然中文样本（混排常用字，避免单字重复失真） */
function cnSample(n: number): string {
  const pool = '春秋冬夏日月山河林木风云雨雪天地人心口手足目耳';
  let out = '';
  for (let i = 0; i < n; i++) out += pool[i % pool.length];
  return out;
}

describe('countTokensApprox 纯中文', () => {
  it.each([100, 500, 2000])('%i 字样本 ≈ 字数×1.5（±15%）', (n) => {
    const tokens = countTokensApprox(cnSample(n));
    const anchor = n * 1.5;
    expect(tokens).toBeGreaterThanOrEqual(anchor * 0.85);
    expect(tokens).toBeLessThanOrEqual(anchor * 1.15);
  });
});

describe('countTokensApprox 纯英文', () => {
  it('100 词样本 ≈ 词数×1.3 量级（±15%）', () => {
    const text = 'word '.repeat(100).trim();
    const tokens = countTokensApprox(text);
    const anchor = 100 * 1.3;
    expect(tokens).toBeGreaterThanOrEqual(anchor * 0.85);
    expect(tokens).toBeLessThanOrEqual(anchor * 1.15);
  });
});

describe('countTokensApprox 中英混合手工锚点', () => {
  it('「你好 world 123！」精确计为 9（2 汉字×1.5 + 1 词×1.3 + 4 符号×1，ceil）', () => {
    // 你好=3，world=1.3，123=3，！=1，合计 8.3 → ceil 9；空格计 0
    expect(countTokensApprox('你好 world 123！')).toBe(9);
  });
  it('中文标点按符号计 1/字符（「你好。」= 4）', () => {
    expect(countTokensApprox('你好。')).toBe(4); // 1.5×2 + 1
  });
});

describe('countTokensApprox 边界', () => {
  it('空串为 0', () => {
    expect(countTokensApprox('')).toBe(0);
  });
  it('纯空白为 0（空白不计 token）', () => {
    expect(countTokensApprox('  \n\t ')).toBe(0);
  });
});

describe('fillBudget 装填（items 按新→旧排序）', () => {
  interface Item {
    id: string;
  }
  const tokenOf = () => 10;

  it('预算充足全部装下：truncated=false，顺序保持新→旧', () => {
    const items: Item[] = [{ id: '新' }, { id: '中' }, { id: '旧' }];
    const { included, truncated } = fillBudget(items, tokenOf, 30);
    expect(truncated).toBe(false);
    expect(included.map((i) => i.id)).toEqual(['新', '中', '旧']);
  });

  it('预算装不下最旧项：truncated=true，最旧被裁、装填即停', () => {
    const items: Item[] = [{ id: '新' }, { id: '中' }, { id: '旧' }];
    const { included, truncated } = fillBudget(items, tokenOf, 25);
    expect(truncated).toBe(true);
    expect(included.map((i) => i.id)).toEqual(['新', '中']);
  });

  it('首项即超预算：首项必装（否则生成无上下文），无后续项则 truncated=false', () => {
    const items: Item[] = [{ id: '巨' }];
    const { included, truncated } = fillBudget(items, () => 100, 50);
    expect(included.map((i) => i.id)).toEqual(['巨']);
    expect(truncated).toBe(false);
  });

  it('首项超预算且有后续项：首项保留、后续全裁、truncated=true', () => {
    const items: Item[] = [{ id: '巨' }, { id: '旧' }];
    const { included, truncated } = fillBudget(items, (i) => (i.id === '巨' ? 100 : 10), 50);
    expect(included.map((i) => i.id)).toEqual(['巨']);
    expect(truncated).toBe(true);
  });

  it('空 items：返回空且不截断', () => {
    const { included, truncated } = fillBudget<Item>([], tokenOf, 100);
    expect(included).toEqual([]);
    expect(truncated).toBe(false);
  });
});
