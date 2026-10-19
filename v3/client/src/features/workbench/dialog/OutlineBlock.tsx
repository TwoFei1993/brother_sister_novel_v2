/**
 * 章节要点提纲折叠条（显示层：splitOutline 产物渲染，用户需求"默认收起"）
 *
 * - 收起态一行「📋 本章要点提纲（点击展开）」，不干扰正文阅读；点击展开，再点收起
 * - 展开内容走提纲 markdown 渲染：显示轨正则（§5.1②）+ §9.3 双层净化，与 BubbleMarkdown 同管道
 * 宿主：ReadingView（B 视图）与 MessageBubble（A 视图）在章头渲染正文前调用。
 */
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import type { TavernRegexScript } from '@shared/tavern';

import { applyDisplayRegex, MARKDOWN_CLASS } from '../../../lib/reading/markdown';
import { sanitizeMarkdownSource } from '../../../lib/sanitize';

interface OutlineBlockProps {
  outline: string;
  /** 显示轨正则脚本（markdownOnly，与正文渲染同源传入） */
  regexScripts?: TavernRegexScript[];
}

export default function OutlineBlock({ outline, regexScripts }: OutlineBlockProps) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid="outline-block"
      className="mb-3 overflow-hidden rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))]"
    >
      <button
        type="button"
        data-testid="outline-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-[hsl(var(--fg-muted))] transition-colors hover:text-[hsl(var(--fg))]"
      >
        <span aria-hidden="true">📋</span>
        本章要点提纲（点击{open ? '收起' : '展开'}）
      </button>
      {open && (
        <div className={`${MARKDOWN_CLASS} border-t border-[hsl(var(--border-soft))] px-3 py-2 text-sm`}>
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
            {sanitizeMarkdownSource(applyDisplayRegex(outline, regexScripts))}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
