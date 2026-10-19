/**
 * 下拉框统一配色常量（第二轮体验改进）。
 *
 * 背景：原生 <select> 在深色主题下若用 bg-transparent 会回落系统白底黑字，
 * 与全站主题脱节。统一规则：
 * - select 显式设 bg / text / border（Chrome 下 option 继承 select 的背景色）
 * - option 仍显式设 bg，覆盖 Firefox 等不继承的引擎
 * 各处 select 按尺寸微调 padding/高度，但底色三件套统一取本常量。
 */

/** select 主体类（底色/文字/边框/焦点环；尺寸类由使用处追加） */
export const SELECT_TONE_CLS =
  'bg-[hsl(var(--bg))] text-[hsl(var(--fg))] outline-none focus:border-[hsl(var(--accent))]';

/** option 类（非继承引擎的兜底配色） */
export const OPTION_CLS = 'bg-[hsl(var(--bg))] text-[hsl(var(--fg))]';
