/**
 * 思考过程折叠块（用户反馈⑨：模型思维流不再黑盒——捕获后可展开查看，便于判断生成问题来源）
 *
 * - 默认收起一行「💭 思考过程（点击展开）」，不干扰阅读；样式对齐 OutlineBlock（muted 小字+浅底色）
 * - 展开内容为**纯文本**渲染（React 文本节点自动转义，不走 markdown/HTML 管道——思考流含
 *   <tag> 片段属常态，转义展示最安全），保留换行便于阅读
 * - 宿主：ReadingView 章节头与 chat MessageBubble（仅 extra.rawThinking 非空时渲染）
 */
import { useState } from 'react';

export default function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-testid="thinking-block"
      className="mb-3 overflow-hidden rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))]"
    >
      <button
        type="button"
        data-testid="thinking-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-[hsl(var(--fg-muted))] transition-colors hover:text-[hsl(var(--fg))]"
      >
        <span aria-hidden="true">💭</span>
        思考过程（点击{open ? '收起' : '展开'}）
      </button>
      {open && (
        <div
          data-testid="thinking-content"
          className="max-h-80 overflow-y-auto border-t border-[hsl(var(--border-soft))] px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-[hsl(var(--fg-muted))]"
        >
          {thinking}
        </div>
      )}
    </div>
  );
}
