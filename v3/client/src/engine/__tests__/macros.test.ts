/**
 * 宏引擎测试（设计 §5.1③）
 * 锚点：酒馆 substituteParamsLegacy（public/script.js:2831）语义——
 *   {{user}}/{{char}} 必须最后替换（script.js:2980 注释：Must be substituted last），
 *   保证嵌套宏产出物中的 user/char 也被替换；{{original}} 消费一次（二次出现为空串）；
 *   未知宏原样保留；宏名大小写不敏感；变量宏 getvar/setvar（scripts/variables.js:241,249）。
 */
import { describe, expect, it } from 'vitest';

import type { MacroEnv, MacroScope } from '../types';
import { substituteParams } from '../prompt/macros';

/** 内存变量表 mock：key 为 `${scope}:${name}`，模拟 useGenerate 持久化前的读写 */
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

describe('{{user}} / {{char}} 替换', () => {
  it('替换为 env 提供的用户名与角色名', () => {
    const { env } = makeEnv();
    expect(substituteParams('你好 {{user}}，我是 {{char}}', env)).toBe(
      '你好 阿明，我是 爱丽丝',
    );
  });

  it('同一文本内多处出现全部替换', () => {
    const { env } = makeEnv();
    expect(substituteParams('{{char}}对{{char}}说', env)).toBe('爱丽丝对爱丽丝说');
  });
});

describe('{{original}} 替换（酒馆语义：消费一次）', () => {
  it('首次出现替换为原文', () => {
    const { env } = makeEnv({ original: '原始消息' });
    expect(substituteParams('改写：{{original}}', env)).toBe('改写：原始消息');
  });

  it('再次出现替换为空串（防止原文重复注入）', () => {
    const { env } = makeEnv({ original: '原始消息' });
    expect(substituteParams('A:{{original}} B:{{original}}', env)).toBe('A:原始消息 B:');
  });

  it('env.original 未提供时替换为空串', () => {
    const { env } = makeEnv();
    expect(substituteParams('X{{original}}Y', env)).toBe('XY');
  });
});

describe('{{getvar::name}} 读取', () => {
  it('命中时替换为变量值', () => {
    const { env, store, key } = makeEnv();
    store.set(key('age', 'work'), '25');
    expect(substituteParams('年龄 {{getvar::age}}', env)).toBe('年龄 25');
  });

  it('未命中时替换为空串', () => {
    const { env } = makeEnv();
    expect(substituteParams('值=[{{getvar::missing}}]', env)).toBe('值=[]');
  });
});

describe('{{setvar::name::value}} 写入', () => {
  it('以 (name, value, scope) 调用 setVar 回调，并从文本消解为空串', () => {
    const calls: Array<[string, string, MacroScope]> = [];
    const { env } = makeEnv({
      setVar: (name, value, scope) => {
        calls.push([name, value, scope]);
      },
    });
    const out = substituteParams('前{{setvar::mood::开心}}后', env);
    expect(out).toBe('前后');
    expect(calls).toEqual([['mood', '开心', 'work']]);
  });

  it('写入后同文本内 getvar 立即可读（先 setvar 后 getvar 的顺序）', () => {
    const { env } = makeEnv();
    expect(substituteParams('{{setvar::lv::7}}等级{{getvar::lv}}', env)).toBe('等级7');
  });
});

describe('未知宏', () => {
  it('不在支持清单内的宏原样保留', () => {
    const { env } = makeEnv();
    expect(substituteParams('{{random::a::b}} {{foo}} 保持{{originalX}}', env)).toBe(
      '{{random::a::b}} {{foo}} 保持{{originalX}}',
    );
  });
});

describe('嵌套宏（user/char 最后替换语义）', () => {
  it('setvar 值含 {{char}}/{{user}}：原样入变量，getvar 展开后由最终 pass 替换', () => {
    const { env, store, key } = makeEnv();
    const out = substituteParams(
      '{{setvar::greeting::{{char}}向{{user}}问好}}{{getvar::greeting}}',
      env,
    );
    expect(store.get(key('greeting', 'work'))).toBe('{{char}}向{{user}}问好');
    expect(out).toBe('爱丽丝向阿明问好');
  });

  it('getvar 展开值中再含 getvar：多轮 pass 链式收敛', () => {
    const { env, store, key } = makeEnv();
    store.set(key('x', 'work'), '{{getvar::y}}');
    store.set(key('y', 'work'), '{{char}}出场');
    expect(substituteParams('{{getvar::x}}', env)).toBe('爱丽丝出场');
  });

  it('变量值来自外部数据（含 {{user}} 字面量）时同样被最终替换', () => {
    const { env, store, key } = makeEnv();
    store.set(key('note', 'work'), '来自 {{user}} 的便签');
    expect(substituteParams('提示：{{getvar::note}}', env)).toBe('提示：来自 阿明 的便签');
  });
});

describe('大小写不敏感', () => {
  it('{{User}}/{{CHAR}}/{{GetVar::x}} 与小写等效（变量名本身保持大小写）', () => {
    const { env, store, key } = makeEnv();
    store.set(key('Score', 'work'), '99');
    expect(substituteParams('{{User}} {{CHAR}} {{GetVar::Score}}', env)).toBe(
      '阿明 爱丽丝 99',
    );
  });

  it('宏名内允许空白：{{ user }} 等效', () => {
    const { env } = makeEnv();
    expect(substituteParams('{{ user }}与{{ char }}', env)).toBe('阿明与爱丽丝');
  });
});

describe('作用域路由', () => {
  it('getvar::work:a 与 getvar::global:b 分别路由到对应作用域', () => {
    const { env, store, key } = makeEnv();
    store.set(key('a', 'work'), '作品级');
    store.set(key('b', 'global'), '全局');
    expect(substituteParams('{{getvar::work:a}}/{{getvar::global:b}}', env)).toBe(
      '作品级/全局',
    );
  });

  it('无前缀默认路由到 work 作用域', () => {
    const { env, store, key } = makeEnv();
    store.set(key('v', 'work'), '默认作品');
    store.set(key('v', 'global'), '全局同名');
    expect(substituteParams('{{getvar::v}}', env)).toBe('默认作品');
  });

  it('setvar 支持作用域前缀写入 global', () => {
    const calls: Array<[string, string, MacroScope]> = [];
    const { env } = makeEnv({
      setVar: (name, value, scope) => {
        calls.push([name, value, scope]);
      },
    });
    substituteParams('{{setvar::global:token::abc}}', env);
    expect(calls).toEqual([['token', 'abc', 'global']]);
  });

  it('同名变量在两个作用域互不串扰（未命中回退为空，不跨作用域查找）', () => {
    const { env, store, key } = makeEnv();
    store.set(key('onlyWork', 'work'), 'W');
    expect(substituteParams('[{{getvar::global:onlyWork}}]', env)).toBe('[]');
  });
});

describe('边界', () => {
  it('空文本返回空串', () => {
    const { env } = makeEnv();
    expect(substituteParams('', env)).toBe('');
  });

  it('无宏文本原样返回', () => {
    const { env } = makeEnv();
    expect(substituteParams('普通文本，没有宏。', env)).toBe('普通文本，没有宏。');
  });
});
