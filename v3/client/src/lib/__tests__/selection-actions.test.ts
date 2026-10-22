import { describe, expect, it } from 'vitest';

import { SELECTION_MODES, applySelectionResult, selectionPrompt } from '../selection-actions';

describe('selectionPrompt（选段提示词构造）', () => {
  it('三种模式各自携带任务定义与选段原文', () => {
    for (const { mode } of SELECTION_MODES) {
      const p = selectionPrompt(mode, '他推开了门。', '前文上下文……');
      expect(p).toContain('他推开了门。');
      expect(p).toContain('只输出处理后的正文本身');
    }
    expect(selectionPrompt('polish', 'x', '')).toContain('润色');
    expect(selectionPrompt('expand', 'x', '')).toContain('扩写');
    expect(selectionPrompt('rewrite', 'x', '')).toContain('重写');
  });

  it('携带前方上下文摘录（截取尾部 400 字）', () => {
    const p = selectionPrompt('polish', '选段', '前'.repeat(600));
    expect(p).toContain('前'.repeat(400).slice(0, 20));
    expect(p).not.toContain('前'.repeat(500));
  });
});

describe('applySelectionResult（选段替换）', () => {
  const content = '开头段落。\n\n中间是目标选段，他推开了门。\n\n结尾段落。';

  it('首次出现的选段被替换，前后文保持不变', () => {
    const out = applySelectionResult(content, '他推开了门。', '他缓缓推开了那扇门。');
    expect(out).toContain('他缓缓推开了那扇门。');
    expect(out).toContain('开头段落。');
    expect(out).toContain('结尾段落。');
    expect(out).not.toContain('他推开了门。');
  });

  it('选段不存在（并发编辑）→ null 由调用方提示', () => {
    expect(applySelectionResult(content, '不存在的文本', '新文')).toBeNull();
  });
});

describe('SELECTION_MODES 清单', () => {
  it('三种模式齐全且有中文标签', () => {
    expect(SELECTION_MODES.map((m) => m.mode)).toEqual(['polish', 'expand', 'rewrite']);
    expect(SELECTION_MODES.every((m) => m.label.length > 0 && m.hint.length > 0)).toBe(true);
  });
});
