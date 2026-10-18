/**
 * markdown 渲染公共配置（设计 §9.3）：正文排版类名
 *
 * ReadingView（B 视图）与 dialog/MessageBubble（A 视图）共用同一套
 * Tailwind 任意变体排版，避免动 index.css——主题体系 Task 32 定型。
 * 净化管道见同目录 sanitize.ts（第一层 DOMPurify；第二层 rehype-sanitize 在渲染层）。
 */

/** 正文 markdown 基础排版（p/h1-h3/blockquote/ul/ol/a/hr/code 间距与配色） */
export const MARKDOWN_CLASS =
  '[&_p]:my-3 [&_h1]:my-4 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:my-4 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:my-3 [&_h3]:font-bold [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[hsl(var(--border-soft))] [&_blockquote]:pl-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:text-[hsl(var(--accent))] [&_a]:underline [&_hr]:my-4 [&_code]:rounded [&_code]:bg-[hsl(var(--surface))] [&_code]:px-1 [&_code]:text-[0.9em]';
