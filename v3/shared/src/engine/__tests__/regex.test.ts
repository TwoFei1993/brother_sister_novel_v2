/**
 * 正则双轨引擎测试（设计 §5.1②）
 * 锚点：酒馆 public/scripts/extensions/regex/engine.js:334 getRegexedString、:391 runRegexScript——
 *   时点过滤（markdownOnly/promptOnly/双 false）、placement 数值枚举（1/2/3/5/6）、
 *   {{match}}→$0 整体匹配、$1/$<name> 逐捕获组剥离 trimStrings、
 *   substituteRegex RAW=1 宏注入 findRegex、替换结果末尾再过一次 substituteParams（:444）。
 */
import { describe, expect, it } from 'vitest';

import type { TavernRegexScript } from '@shared/tavern';

import type { MacroEnv, MacroScope } from '../types';
import { getRegexedString, placementMatches, runRegexScript } from '../prompt/regex';

/** 构造脚本：placement 默认 [2]（ai_output），depth 默认 -1（不限），runOnEdit 默认 true */
function makeScript(overrides: Partial<TavernRegexScript> = {}): TavernRegexScript {
  return {
    id: 's1',
    scriptName: '测试脚本',
    findRegex: '',
    replaceString: '',
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: -1,
    maxDepth: -1,
    ...overrides,
  };
}

/** 内存变量表 mock（同 macros.test.ts）：key 为 `${scope}:${name}` */
function makeEnv(overrides: Partial<MacroEnv> = {}) {
  const store = new Map<string, string>();
  const key = (name: string, scope: MacroScope): string => `${scope}:${name}`;
  const env: MacroEnv = {
    user: '阿明',
    char: '爱丽丝',
    scope: 'work',
    getVar: (name, scope) => store.get(key(name, scope)),
    setVar: (name, value, scope) => {
      store.set(key(name, scope), value);
    },
    ...overrides,
  };
  return { env, store, key };
}

/** 基础运行上下文：非 markdown 非 prompt 轨（双 false 脚本在此生效） */
const baseCtx = { isMarkdown: false, isPrompt: false };

describe('runRegexScript 基础替换', () => {
  it('全局替换 + {{match}} 引用整体匹配（大小写不敏感）', () => {
    const script = makeScript({ findRegex: '\\d+', replaceString: '[{{MATCH}}]' });
    expect(runRegexScript('第12章，共34页', script, baseCtx)).toBe('第[12]章，共[34]页');
  });

  it('$1 数字捕获组展开', () => {
    const script = makeScript({ findRegex: '(\\d+)元', replaceString: '$1块' });
    expect(runRegexScript('价格10元，运费5元', script, baseCtx)).toBe('价格10块，运费5块');
  });

  it('$<name> 命名捕获组展开', () => {
    const script = makeScript({ findRegex: '(?<who>.+?)说', replaceString: '$<who>：' });
    expect(runRegexScript('爱丽丝说你好', script, baseCtx)).toBe('爱丽丝：你好');
  });

  it('可选捕获组未参与匹配时消解为空串，参与时正常展开（酒馆语义：!match → ""）', () => {
    const script = makeScript({ findRegex: 'a(b)?c', replaceString: 'X$1Y' });
    expect(runRegexScript('ac abc', script, baseCtx)).toBe('XY XbY');
  });

  it('非法正则不抛异常，原样返回（酒馆 RegexProvider 返回 null 语义）', () => {
    const script = makeScript({ findRegex: '[', replaceString: 'y' });
    expect(runRegexScript('x[', script, baseCtx)).toBe('x[');
  });
});

describe('runRegexScript 前置过滤', () => {
  it('disabled=true 跳过', () => {
    const script = makeScript({ findRegex: 'x', replaceString: 'y', disabled: true });
    expect(runRegexScript('xxx', script, baseCtx)).toBe('xxx');
  });

  it('markdownOnly 仅 isMarkdown 轨生效', () => {
    const script = makeScript({ findRegex: ' 剧透', replaceString: '', markdownOnly: true });
    expect(runRegexScript('结局 剧透', script, baseCtx)).toBe('结局 剧透');
    expect(runRegexScript('结局 剧透', script, { ...baseCtx, isMarkdown: true })).toBe('结局');
  });

  it('promptOnly 仅 isPrompt 轨生效', () => {
    const script = makeScript({ findRegex: 'OOC:', replaceString: '', promptOnly: true });
    expect(runRegexScript('OOC:忽略上文', script, baseCtx)).toBe('OOC:忽略上文');
    expect(runRegexScript('OOC:忽略上文', script, { ...baseCtx, isPrompt: true })).toBe('忽略上文');
  });

  it('minDepth/maxDepth 过滤（-1 不限；未传 depth 不做深度过滤）', () => {
    const script = makeScript({
      findRegex: 'A',
      replaceString: 'B',
      minDepth: 1,
      maxDepth: 3,
    });
    expect(runRegexScript('A', script, { ...baseCtx, depth: 0 })).toBe('A');
    expect(runRegexScript('A', script, { ...baseCtx, depth: 1 })).toBe('B');
    expect(runRegexScript('A', script, { ...baseCtx, depth: 4 })).toBe('A');
    expect(runRegexScript('A', script, baseCtx)).toBe('B');
  });

  it('空 findRegex 或空输入原样返回', () => {
    const script = makeScript({ findRegex: '', replaceString: 'y' });
    expect(runRegexScript('x', script, baseCtx)).toBe('x');
    expect(runRegexScript('', makeScript({ findRegex: 'x', replaceString: 'y' }), baseCtx)).toBe('');
  });
});

describe('trimStrings 与宏注入', () => {
  it('trimStrings 从捕获组结果中剥离（trim 串自身支持宏）', () => {
    const script = makeScript({
      findRegex: '<think>([\\s\\S]*?)</think>',
      replaceString: '$1',
      trimStrings: ['（', '）'],
    });
    expect(runRegexScript('前<think>（内心戏）</think>后', script, baseCtx)).toBe('前内心戏后');
  });

  it('substituteRegex=RAW(1)：findRegex 中的宏先展开再编译', () => {
    const { env } = makeEnv();
    env.setVar('pat', '\\d+', 'work');
    const script = makeScript({
      findRegex: '{{getvar::pat}}',
      replaceString: 'N',
      substituteRegex: 1,
    });
    expect(runRegexScript('编号123', script, { ...baseCtx, macroEnv: env })).toBe('编号N');
  });

  it('substituteRegex=NONE(0)：findRegex 宏不展开，按字面匹配不到', () => {
    const { env } = makeEnv();
    env.setVar('pat', '\\d+', 'work');
    const script = makeScript({
      findRegex: '{{getvar::pat}}',
      replaceString: 'N',
      substituteRegex: 0,
    });
    expect(runRegexScript('编号123', script, { ...baseCtx, macroEnv: env })).toBe('编号123');
  });

  it('substituteRegex=ESCAPED(2)：宏展开值转义正则元字符（字面匹配）', () => {
    const { env } = makeEnv();
    env.setVar('v', 'a+', 'work');
    const escaped = makeScript({
      findRegex: '{{getvar::v}}',
      replaceString: 'Q',
      substituteRegex: 2,
    });
    expect(runRegexScript('a+', escaped, { ...baseCtx, macroEnv: env })).toBe('Q');
    expect(runRegexScript('aaa', escaped, { ...baseCtx, macroEnv: env })).toBe('aaa');
    // RAW 对照：a+ 作为量词匹配整个 "aaa"
    const raw = makeScript({
      findRegex: '{{getvar::v}}',
      replaceString: 'Q',
      substituteRegex: 1,
    });
    expect(runRegexScript('aaa', raw, { ...baseCtx, macroEnv: env })).toBe('Q');
  });

  it('替换结果再过一次宏（酒馆 engine.js:444 substituteParams(replaceWithGroups)）', () => {
    const { env } = makeEnv();
    const script = makeScript({ findRegex: 'A', replaceString: '{{user}}来了' });
    expect(runRegexScript('xAx', script, { ...baseCtx, macroEnv: env })).toBe('x阿明来了x');
  });
});

describe('placementMatches 数值映射', () => {
  it('user_input=1 / ai_output=2 / slash_command=3 / world_info=5 / reasoning=6', () => {
    expect(placementMatches([1], 'user_input')).toBe(true);
    expect(placementMatches([2], 'ai_output')).toBe(true);
    expect(placementMatches([3], 'slash_command')).toBe(true);
    expect(placementMatches([5], 'world_info')).toBe(true);
    expect(placementMatches([6], 'reasoning')).toBe(true);
    expect(placementMatches([2], 'user_input')).toBe(false);
    expect(placementMatches([5, 6], 'reasoning')).toBe(true);
  });
});

describe('getRegexedString 管道', () => {
  it('placement 过滤：placement=[2] 的脚本只在 ai_output 生效', () => {
    const scripts = [makeScript({ findRegex: 'x', replaceString: 'y', placement: [2] })];
    const opts = { isMarkdown: false, isPrompt: false };
    expect(getRegexedString('x', 'ai_output', opts, scripts)).toBe('y');
    expect(getRegexedString('x', 'user_input', opts, scripts)).toBe('x');
  });

  it('双 false 脚本全时生效：非 markdown 非 prompt 轨应用，两轨各自跳过', () => {
    // 酒馆注释：双 false 脚本在 isMarkdown 时跳过——源（聊天历史）应已提前改好，避免二次替换
    const scripts = [makeScript({ findRegex: 'x', replaceString: 'y' })];
    expect(getRegexedString('x', 'ai_output', { isMarkdown: false, isPrompt: false }, scripts)).toBe('y');
    expect(getRegexedString('x', 'ai_output', { isMarkdown: true, isPrompt: false }, scripts)).toBe('x');
    expect(getRegexedString('x', 'ai_output', { isMarkdown: false, isPrompt: true }, scripts)).toBe('x');
  });

  it('isEdit=true 时 runOnEdit=false 的脚本跳过', () => {
    const scripts = [makeScript({ findRegex: 'x', replaceString: 'y', runOnEdit: false })];
    const opts = { isMarkdown: false, isPrompt: false, isEdit: true };
    expect(getRegexedString('x', 'ai_output', opts, scripts)).toBe('x');
    expect(getRegexedString('x', 'ai_output', { ...opts, isEdit: false }, scripts)).toBe('y');
  });

  it('多脚本按数组顺序链式应用（前者输出为后者输入）', () => {
    const scripts = [
      makeScript({ id: 'a', scriptName: '甲→乙', findRegex: '甲', replaceString: '乙' }),
      makeScript({ id: 'b', scriptName: '乙→丙', findRegex: '乙', replaceString: '丙' }),
    ];
    expect(
      getRegexedString('甲', 'ai_output', { isMarkdown: false, isPrompt: false }, scripts),
    ).toBe('丙');
  });

  it('空脚本表与空输入兜底', () => {
    const opts = { isMarkdown: false, isPrompt: false };
    expect(getRegexedString('', 'ai_output', opts, [])).toBe('');
    expect(getRegexedString('原样', 'ai_output', opts, [])).toBe('原样');
  });
});
