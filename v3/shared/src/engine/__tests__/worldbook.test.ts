/**
 * 世界书扫描主流程测试（设计 §5.2 一期行为全集）
 * 锚点：酒馆 world-info.js checkWorldInfo(:4709)——constant 直通、disable 跳过、
 * 概率 roll(:5028 Math.random()*100<=probability)、递归过滤(:5080 preventRecursion)、
 * world_info_position(:855 0before/1after/2ANTop/3ANBottom/4atDepth/5EMTop/6EMBottom)、
 * DEFAULT_DEPTH=4(:96)、order 默认 100(:4086)、条目级 scanDepth 覆盖(:281)。
 *
 * 键匹配单元（主键/大小写/全词/二级键四逻辑）见 worldbook.match.test.ts。
 */
import { describe, expect, it } from 'vitest';

import { scanWorldInfo } from '../worldbook/scan';
import { BASE, RNG_STUB, makeBook, makeEntry, scanOne } from './worldbook-fixtures';

// ---------- 直通与开关 ----------

describe('constant / disable / probability', () => {
  it('constant（蓝灯）直通：无需任何文本即激活', () => {
    const r = scanOne(makeEntry({ uid: 1, key: [], content: '常驻设定', constant: true }), []);
    expect(r.activatedIds).toEqual(['b1:1']);
  });

  it('disable 条目跳过：即使键命中也不激活', () => {
    const r = scanOne(makeEntry({ uid: 1, key: ['火龙'], content: 'x', disable: true }), ['遭遇火龙']);
    expect(r.activatedIds).toEqual([]);
  });

  it('probability=0：roll 不通过则永不激活', () => {
    const r = scanOne(
      makeEntry({ uid: 1, key: ['火龙'], content: 'x', useProbability: true, probability: 0 }),
      ['遭遇火龙'],
    );
    expect(r.activatedIds).toEqual([]);
  });

  it('probability=100：恒命中（走快路径不 roll）', () => {
    const r = scanOne(
      makeEntry({ uid: 1, key: ['火龙'], content: 'x', useProbability: true, probability: 100 }),
      ['遭遇火龙'],
    );
    expect(r.activatedIds).toEqual(['b1:1']);
  });

  it('probability=50：rng 注入 0.99 时 roll 失败', () => {
    const r = scanOne(
      makeEntry({ uid: 1, key: ['火龙'], content: 'x', useProbability: true, probability: 50 }),
      ['遭遇火龙'],
    );
    expect(r.activatedIds).toEqual([]);
  });

  it('useProbability=false：不 roll 恒激活（酒馆 verifyProbability 快路径）', () => {
    const r = scanOne(
      makeEntry({ uid: 1, key: ['火龙'], content: 'x', useProbability: false, probability: 1 }),
      ['遭遇火龙'],
    );
    expect(r.activatedIds).toEqual(['b1:1']);
  });
});

// ---------- 递归扫描 ----------

describe('递归扫描', () => {
  it('递归激活：A 的内容含 B 的键，B 在递归轮被激活', () => {
    const book = makeBook('b1', [
      makeEntry({ uid: 1, key: ['火龙'], content: '火龙的主人名叫冰霜巨龙' }),
      makeEntry({ uid: 2, key: ['冰霜巨龙'], content: 'B 设定' }),
    ]);
    const r = scanWorldInfo({
      books: [book],
      chatTexts: ['勇者遭遇了火龙'],
      settings: { ...BASE, recursive: true },
      rng: RNG_STUB,
    });
    expect(r.activatedIds).toEqual(['b1:1', 'b1:2']);
  });

  it('preventRecursion：A 的内容不参与递归触发，B 不被激活', () => {
    const book = makeBook('b1', [
      makeEntry({ uid: 1, key: ['火龙'], content: '火龙的主人名叫冰霜巨龙', preventRecursion: true }),
      makeEntry({ uid: 2, key: ['冰霜巨龙'], content: 'B 设定' }),
    ]);
    const r = scanWorldInfo({
      books: [book],
      chatTexts: ['勇者遭遇了火龙'],
      settings: { ...BASE, recursive: true },
      rng: RNG_STUB,
    });
    expect(r.activatedIds).toEqual(['b1:1']);
  });

  it('maxRecursionSteps=1：链式 C1→C2→C3 只走到 C2', () => {
    const book = makeBook('b1', [
      makeEntry({ uid: 1, key: ['k1'], content: '提到 k2' }),
      makeEntry({ uid: 2, key: ['k2'], content: '提到 k3' }),
      makeEntry({ uid: 3, key: ['k3'], content: 'C3 设定' }),
    ]);
    const r = scanWorldInfo({
      books: [book],
      chatTexts: ['k1 出现了'],
      settings: { ...BASE, recursive: true, maxRecursionSteps: 1 },
      rng: RNG_STUB,
    });
    expect(r.activatedIds).toEqual(['b1:1', 'b1:2']);
  });

  it('maxRecursionSteps=2：同链 C3 被激活', () => {
    const book = makeBook('b1', [
      makeEntry({ uid: 1, key: ['k1'], content: '提到 k2' }),
      makeEntry({ uid: 2, key: ['k2'], content: '提到 k3' }),
      makeEntry({ uid: 3, key: ['k3'], content: 'C3 设定' }),
    ]);
    const r = scanWorldInfo({
      books: [book],
      chatTexts: ['k1 出现了'],
      settings: { ...BASE, recursive: true, maxRecursionSteps: 2 },
      rng: RNG_STUB,
    });
    expect(r.activatedIds).toEqual(['b1:1', 'b1:2', 'b1:3']);
  });

  it('recursive=false：A 的内容含 B 的键也不触发递归', () => {
    const book = makeBook('b1', [
      makeEntry({ uid: 1, key: ['火龙'], content: '火龙的主人名叫冰霜巨龙' }),
      makeEntry({ uid: 2, key: ['冰霜巨龙'], content: 'B 设定' }),
    ]);
    const r = scanWorldInfo({
      books: [book],
      chatTexts: ['勇者遭遇了火龙'],
      settings: BASE,
      rng: RNG_STUB,
    });
    expect(r.activatedIds).toEqual(['b1:1']);
  });
});

// ---------- 位置分组与排序 ----------

describe('位置分组与 order 排序', () => {
  it('order 降序：before 内高 order 在前', () => {
    const book = makeBook('b1', [
      makeEntry({ uid: 1, key: ['k'], content: '低优先', order: 10, position: 0 }),
      makeEntry({ uid: 2, key: ['k'], content: '高优先', order: 50, position: 0 }),
    ]);
    const r = scanWorldInfo({ books: [book], chatTexts: ['k'], settings: BASE, rng: RNG_STUB });
    expect(r.before).toEqual(['高优先', '低优先']);
  });

  it('position 分组：0→before、1→after、4→atDepth（带 depth/role/order）', () => {
    const book = makeBook('b1', [
      makeEntry({ uid: 1, key: ['k'], content: '前置', order: 10, position: 0 }),
      makeEntry({ uid: 2, key: ['k'], content: '后置', order: 10, position: 1 }),
      makeEntry({ uid: 3, key: ['k'], content: '深度', order: 7, position: 4, depth: 2, role: 1 }),
    ]);
    const r = scanWorldInfo({ books: [book], chatTexts: ['k'], settings: BASE, rng: RNG_STUB });
    expect(r.before).toEqual(['前置']);
    expect(r.after).toEqual(['后置']);
    expect(r.depthEntries).toEqual([{ content: '深度', depth: 2, role: 'user', order: 7 }]);
  });

  it('ANTop(2)/EMTop(5) 映射到 before；ANBottom(3)/EMBottom(6) 映射到 after', () => {
    const book = makeBook('b1', [
      makeEntry({ uid: 1, key: ['k'], content: 'AN顶', position: 2 }),
      makeEntry({ uid: 2, key: ['k'], content: 'AN底', position: 3 }),
      makeEntry({ uid: 3, key: ['k'], content: 'EM顶', position: 5 }),
      makeEntry({ uid: 4, key: ['k'], content: 'EM底', position: 6 }),
    ]);
    const r = scanWorldInfo({ books: [book], chatTexts: ['k'], settings: BASE, rng: RNG_STUB });
    expect(r.before.sort()).toEqual(['AN顶', 'EM顶'].sort());
    expect(r.after.sort()).toEqual(['AN底', 'EM底'].sort());
    expect(r.depthEntries).toEqual([]);
  });

  it('depthEntries 同 depth 按 order 降序；depth 缺省 4（酒馆 DEFAULT_DEPTH）、role 缺省 system', () => {
    const book = makeBook('b1', [
      makeEntry({ uid: 1, key: ['k'], content: '后进', order: 1, position: 4 }),
      makeEntry({ uid: 2, key: ['k'], content: '先进', order: 9, position: 4 }),
    ]);
    const r = scanWorldInfo({ books: [book], chatTexts: ['k'], settings: BASE, rng: RNG_STUB });
    expect(r.depthEntries).toEqual([
      { content: '先进', depth: 4, role: 'system', order: 9 },
      { content: '后进', depth: 4, role: 'system', order: 1 },
    ]);
  });

  it('atDepth role 数字映射：0=system 1=user 2=assistant，非法值兜底 system', () => {
    const book = makeBook('b1', [
      makeEntry({ uid: 1, key: ['k'], content: 'a', position: 4, role: 2 }),
      makeEntry({ uid: 2, key: ['k'], content: 'b', position: 4, role: 9 }),
    ]);
    const r = scanWorldInfo({ books: [book], chatTexts: ['k'], settings: BASE, rng: RNG_STUB });
    expect(r.depthEntries.map((d) => d.role).sort()).toEqual(['assistant', 'system']);
  });
});

// ---------- 扫描深度 / 条目级覆盖 / 多书 ----------

describe('扫描深度与条目级覆盖、多书合并', () => {
  it('全局 scanDepth 限制扫描窗口：窗口外的消息不参与匹配', () => {
    const r = scanOne(makeEntry({ uid: 1, key: ['秘钥'], content: 'x' }), ['新消息', '旧消息含秘钥'], {
      scanDepth: 1,
    });
    expect(r.activatedIds).toEqual([]);
  });

  it('条目级 scanDepth 覆盖全局：条目可见更深的窗口（null 继承全局）', () => {
    const book = makeBook('b1', [
      makeEntry({ uid: 1, key: ['秘钥'], content: '继承全局', scanDepth: null }),
      makeEntry({ uid: 2, key: ['秘钥'], content: '条目覆盖', scanDepth: 2 }),
    ]);
    const r = scanWorldInfo({
      books: [book],
      chatTexts: ['新消息', '旧消息含秘钥'],
      settings: { ...BASE, scanDepth: 1 },
      rng: RNG_STUB,
    });
    expect(r.activatedIds).toEqual(['b1:2']);
  });

  it('多书合并：两本书的条目均可激活，activatedId 带书前缀', () => {
    const books = [
      makeBook('bookA', [makeEntry({ uid: 7, key: ['火龙'], content: 'A' })]),
      makeBook('bookB', [makeEntry({ uid: 3, key: ['火龙'], content: 'B' })]),
    ];
    const r = scanWorldInfo({ books, chatTexts: ['遭遇火龙'], settings: BASE, rng: RNG_STUB });
    expect(r.activatedIds.sort()).toEqual(['bookA:7', 'bookB:3']);
    expect(r.before.sort()).toEqual(['A', 'B'].sort());
  });
});
