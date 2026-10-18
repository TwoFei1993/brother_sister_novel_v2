/**
 * markdown 净化管道（设计 §9.3 内容安全）
 *
 * 双保险分层：
 *   ① sanitizeMarkdownSource（本文件，DOMPurify）：对 markdown 源文本剥离恶意 HTML
 *      （script/iframe/事件属性/javascript: 等危险 URI）——任何渲染路径共用第一道防线
 *   ② rehype-sanitize（渲染层，默认 profile）：hast 白名单过滤，兜底协议与标签
 *
 * 导入的第三方正则脚本输出（markdownOnly 轨道）与 AI 原文同样过本管道。
 * 纯函数，可单测（__tests__/sanitize.test.ts）。
 */
import DOMPurify from 'dompurify';

/** 对 markdown 源文本做第一层净化（幂等：净化结果再次净化不变） */
export function sanitizeMarkdownSource(raw: string): string {
  // 字面量配置（默认策略已剥离 script/事件属性，显式禁止高危标签作意图声明）；
  // 未开 RETURN_TRUSTED_TYPE，重载固定返回 string
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload'],
  });
}
