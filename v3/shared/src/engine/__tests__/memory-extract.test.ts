/**
 * 自动记忆抽取纯函数测试（解析/合并/提醒注入；LLM 调用接线在管线层）
 */
import { describe, expect, it } from 'vitest';

import {
  foreshadowReminder,
  hashId,
  mergeForeshadows,
  parseMemoryExtract,
} from '../prompt/novel/memory-extract';

describe('parseMemoryExtract（LLM 输出解析）', () => {
  it('标准 JSON 直接解析', () => {
    const r = parseMemoryExtract('{"characterState":"苏檀在北城废墟，左臂脱臼已复位","foreshadows":[{"desc":"神秘男子的身份"}]}');
    expect(r?.characterState).toContain('苏檀');
    expect(r?.foreshadows).toHaveLength(1);
  });

  it('容忍 ```json 代码块包裹与尾随文字', () => {
    const r = parseMemoryExtract('好的，以下是抽取结果：\n```json\n{"characterState":"状态","foreshadows":[]}\n```\n希望有帮助');
    expect(r?.characterState).toBe('状态');
    expect(r?.foreshadows).toHaveLength(0);
  });

  it('characterState 缺失/非字符串 → null（视为抽取失败）', () => {
    expect(parseMemoryExtract('{"foreshadows":[]}')).toBeNull();
    expect(parseMemoryExtract('完全不是 JSON')).toBeNull();
  });

  it('foreshadows 元素缺 desc → 过滤不炸', () => {
    const r = parseMemoryExtract('{"characterState":"s","foreshadows":[{},{"desc":"钩子"}]}');
    expect(r?.foreshadows).toHaveLength(1);
  });
});

describe('mergeForeshadows（去重合并）', () => {
  it('新伏笔追加并生成稳定 id', () => {
    const merged = mergeForeshadows([{ id: 'a1', desc: '旧伏笔', plantedAt: 1 }], 5, [{ desc: '新钩子' }]);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ desc: '新钩子', plantedAt: 5 });
    expect(merged[1].id).toBeTruthy();
  });

  it('同描述去重（同章重复抽取不产生重复登记）', () => {
    const first = mergeForeshadows(undefined, 3, [{ desc: '神秘地图' }]);
    const second = mergeForeshadows(first, 3, [{ desc: '神秘地图' }]);
    expect(second).toHaveLength(1);
  });

  it('已回收的伏笔再次埋设 → 旧条目保持已回收，新条目独立登记（不同 plantedAt 不算重复）', () => {
    const merged = mergeForeshadows([{ id: 'x', desc: '旧钩子', plantedAt: 2, resolved: true }], 6, [{ desc: '旧钩子' }]);
    expect(merged).toHaveLength(2);
    expect(merged[0].resolved).toBe(true);
    expect(merged[1]).toMatchObject({ desc: '旧钩子', plantedAt: 6 });
    expect(merged[1].resolved).toBeUndefined();
  });
});

describe('foreshadowReminder（上下文提醒注入）', () => {
  it('未回收伏笔逐条列出并带埋设章号', () => {
    const r = foreshadowReminder([
      { id: 'a', desc: '神秘地图的来历', plantedAt: 2 },
      { id: 'b', desc: '哥哥的旧伤', plantedAt: 4, resolved: true },
      { id: 'c', desc: '考官的眼神', plantedAt: 6 },
    ]);
    expect(r).toContain('1. 神秘地图的来历（第2章埋）');
    expect(r).toContain('2. 考官的眼神（第6章埋）');
    expect(r).not.toContain('旧伤');
  });

  it('空列表/undefined → 空串（不注入空块）', () => {
    expect(foreshadowReminder(undefined)).toBe('');
    expect(foreshadowReminder([])).toBe('');
  });
});

describe('hashId（稳定去重 id）', () => {
  it('同文本同 id，异文本异 id', () => {
    expect(hashId('神秘地图')).toBe(hashId('神秘地图'));
    expect(hashId('神秘地图')).not.toBe(hashId('神秘地图的来历'));
  });
});
