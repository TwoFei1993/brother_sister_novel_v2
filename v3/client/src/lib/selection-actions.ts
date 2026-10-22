/**
 * 选段 AI 操作（Sudowrite 式局部编辑）：润色/扩写/重写 三种模式
 *
 * 纯函数层：提示词构造 + 结果应用（字符串替换），IO（LLM 调用/PATCH）在组件层。
 * 对齐主流工具的局部编辑语义：
 *  - 润色：保持原意与篇幅，提升语言质感
 *  - 扩写：放大感官细节，篇幅约 1.5-2.5 倍
 *  - 重写：同一情节换一种写法（结构可变，事实不变）
 */

export type SelectionMode = 'polish' | 'expand' | 'rewrite';

export const SELECTION_MODES: ReadonlyArray<{ mode: SelectionMode; label: string; hint: string }> = [
  { mode: 'polish', label: '润色', hint: '保持原意与篇幅，提升语言质感' },
  { mode: 'expand', label: '扩写', hint: '放大感官细节与心理，篇幅约 1.5-2.5 倍' },
  { mode: 'rewrite', label: '重写', hint: '同一情节换一种写法（可调整结构，事实不变）' },
];

export function selectionPrompt(mode: SelectionMode, selection: string, contextBefore: string): string {
  const ctx = contextBefore.trim().slice(-400);
  const base =
    `你是资深中文小说编辑。下面是正文中的一段文字，${ctx ? `它前方的上下文摘录：\n${ctx}\n\n` : ''}` +
    `【待处理段落】\n${selection}\n\n`;
  const tasks: Record<SelectionMode, string> = {
    polish:
      '任务【润色】：保持原意、篇幅与所有事实不变，提升语言质感——修正冗词、强化画面与节奏，不要新增情节。',
    expand:
      '任务【扩写】：在事实与走向不变的前提下放大感官细节、动作分解与心理层次，篇幅约 1.5-2.5 倍。不要新增改变走向的情节。',
    rewrite: '任务【重写】：同一情节换一种写法——叙事角度/结构/句式可以大改，但人物、事实与走向不得改变。',
  };
  return base + tasks[mode] + '\n\n只输出处理后的正文本身（禁止解释、前言或元信息），段落起止要能自然衔接前后文。';
}

/**
 * 把选段在原文中的第一次出现替换为处理结果；选段已不存在（被并发编辑）→ 返回 null 由调用方提示
 */
export function applySelectionResult(content: string, selection: string, result: string): string | null {
  const idx = content.indexOf(selection);
  if (idx === -1) return null;
  return content.slice(0, idx) + result.trim() + content.slice(idx + selection.length);
}
