/**
 * 宏替换引擎（设计 §5.1③）
 *
 * 语义锚点：酒馆 substituteParamsLegacy（SillyTavern public/script.js:2831）
 * 与变量宏（public/scripts/variables.js:241,249）：
 * - 宏名大小写不敏感（/gi），宏名两侧允许空白：{{ user }} 等效 {{user}}
 * - {{setvar::name::value}} 执行写入并从文本消解为空串；name trim、value 原样
 * - {{getvar::name}} 未命中消解为空串；变量名本身大小写敏感
 * - {{original}} 消费一次：首次取 env.original，再次出现消解为空串（防原文重复注入）
 * - {{user}}/{{char}} 最后替换（script.js:2980 注释 "Must be substituted last"）：
 *   嵌套宏（getvar 展开物、setvar 存入值）产出的 {{user}}/{{char}} 字面量同样被替换
 * - 未知宏原样保留
 *
 * 嵌套解析：setvar 的 value 允许包含一层 {{...}} 嵌套（交替模式），
 * 存入变量时保持原文不展开；多轮 pass（≤MAX_PASSES）收敛链式引用，
 * 超限后残留宏原样输出（防变量自引用死循环）。
 */
import type { MacroEnv, MacroScope } from '../types';

/** 最大展开轮数：防止变量自引用（{{getvar::self}} 值为自身）导致死循环 */
const MAX_PASSES = 10;

/**
 * setvar：name 非贪婪匹配到第一个 ::（允许 work:name / global:name 作用域前缀）；
 * value 用交替模式支持一层 {{...}} 嵌套——
 * 使 {{setvar::a::{{char}}出场}} 的 value 完整为 "{{char}}出场" 而非在内层 }} 截断
 */
const SETVAR_RE =
  /\{\{\s*setvar\s*::\s*([\s\S]*?)\s*::\s*((?:\{\{[^{}]*\}\}|[^{}])*)\s*\}\}/gi;

const GETVAR_RE = /\{\{\s*getvar\s*::\s*([\s\S]*?)\s*\}\}/gi;
const ORIGINAL_RE = /\{\{\s*original\s*\}\}/gi;
const USER_RE = /\{\{\s*user\s*\}\}/gi;
const CHAR_RE = /\{\{\s*char\s*\}\}/gi;

/** 作用域前缀：work:xxx / global:xxx（前缀属宏语法，大小写不敏感；变量名保留原样） */
const SCOPE_PREFIX_RE = /^(work|global):(.*)$/i;

/** 解析变量名与作用域：显式前缀路由，无前缀用 env.scope（约定 'work'） */
function parseVarSpec(rawName: string, env: MacroEnv): { name: string; scope: MacroScope } {
  const text = rawName.trim();
  const matched = SCOPE_PREFIX_RE.exec(text);
  if (matched) {
    return { scope: matched[1].toLowerCase() as MacroScope, name: matched[2].trim() };
  }
  return { scope: env.scope, name: text };
}

/**
 * 宏替换主入口（纯函数）：变量读写经由 env.getVar / env.setVar 回调，
 * 持久化由调用方负责。未知宏原样保留。
 */
export function substituteParams(text: string, env: MacroEnv): string {
  if (!text) return '';

  let result = text;
  let originalConsumed = false;

  // 阶段一：变量与 original，多轮展开直至无命中（链式/嵌套引用收敛）
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let touched = false;

    result = result.replace(
      SETVAR_RE,
      (_match: string, rawName: string, value: string) => {
        touched = true;
        const { name, scope } = parseVarSpec(rawName, env);
        env.setVar(name, value, scope);
        return '';
      },
    );

    result = result.replace(GETVAR_RE, (_match: string, rawName: string) => {
      touched = true;
      const { name, scope } = parseVarSpec(rawName, env);
      return env.getVar(name, scope) ?? '';
    });

    result = result.replace(ORIGINAL_RE, () => {
      touched = true;
      if (originalConsumed) return '';
      originalConsumed = true;
      return env.original ?? '';
    });

    if (!touched) break;
  }

  // 阶段二：user/char 最后替换（酒馆语义，覆盖嵌套宏产出物）
  result = result.replace(USER_RE, () => env.user);
  result = result.replace(CHAR_RE, () => env.char);

  return result;
}
