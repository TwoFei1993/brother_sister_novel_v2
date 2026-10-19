/**
 * 净化 markdown 气泡正文（自 MessageBubble 拆出，规范修复）
 *
 * §9.3 双保险：sanitizeMarkdownSource（DOMPurify 第一层）+ rehype-sanitize（第二层）。
 * 渲染前应用显示轨正则（markdownOnly 脚本，§5.1②）；promptOnly 脚本不参与显示。
 */
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import type { TavernRegexScript } from '@shared/tavern';

import { applyDisplayRegex, MARKDOWN_CLASS } from '../../../lib/reading/markdown';
import { sanitizeMarkdownSource } from '../../../lib/sanitize';

export default function BubbleMarkdown({ text, regexScripts }: { text: string; regexScripts?: TavernRegexScript[] }) {
  return (
    <div className={MARKDOWN_CLASS}>
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
        {sanitizeMarkdownSource(applyDisplayRegex(text, regexScripts))}
      </ReactMarkdown>
    </div>
  );
}
