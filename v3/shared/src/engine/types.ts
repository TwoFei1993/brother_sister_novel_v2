/**
 * 引擎层类型（设计 §5 提示词引擎）
 *
 * 引擎保持纯函数：变量读写由调用方（useGenerate）持久化到
 * work.settings.variables（作品级）/ config.globalVariables（全局），
 * 引擎只接收函数引用，不感知存储。
 */

/** 变量作用域：作品级（work.json）/ 全局（config.json），对应设计 §5.1③ */
export type MacroScope = 'work' | 'global';

/** 宏替换环境：substituteParams 的唯一入参 */
export interface MacroEnv {
  /** {{user}} 替换值：当前用户 persona 名 */
  user: string;
  /** {{char}} 替换值：当前激活角色名（chat 多角色时为激活角色，设计 §4.6） */
  char: string;
  /** {{original}} 替换值：原始消息文本；仅首次出现取值，后续出现消解为空串（酒馆语义） */
  original?: string;
  /** 读取变量；未命中返回 undefined（宏层消解为空串） */
  getVar: (name: string, scope: MacroScope) => string | undefined;
  /** 写入变量（{{setvar::name::value}} 触发） */
  setVar: (name: string, value: string, scope: MacroScope) => void;
  /** 无作用域前缀宏的默认作用域；约定传 'work'（作品级） */
  scope: MacroScope;
}
