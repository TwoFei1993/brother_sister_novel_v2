/**
 * 问号提示组件（第二轮体验改进）：小圆 ? 图标 + title 悬停说明。
 *
 * - 悬停/键盘聚焦显示原生 title；触屏长按同样可见
 * - tapToExpand：点击展开内联说明条（触屏友好，用于大按钮旁的提示热区）
 * - 18px 圆圈 muted 配色，不抢视觉；渲染为 button 保证可聚焦
 */
import { useState } from 'react';

export interface FieldHintProps {
  /** 说明文字（title + 点击展开内容） */
  text: string;
  /** true 时点击切换内联说明条（推荐用于 ≥36px 按钮旁的扩展热区） */
  tapToExpand?: boolean;
}

export default function FieldHint({ text, tapToExpand = false }: FieldHintProps) {
  const [expanded, setExpanded] = useState(false);

  const icon = (
    <span
      aria-hidden="true"
      className="inline-flex h-[18px] w-[18px] shrink-0 cursor-help items-center justify-center rounded-full border border-[hsl(var(--fg-muted))]/60 text-[10px] leading-none text-[hsl(var(--fg-muted))] transition-colors group-hover/hint:border-[hsl(var(--accent))] group-hover/hint:text-[hsl(var(--accent))]"
    >
      ?
    </span>
  );

  if (!tapToExpand) {
    return (
      <span className="group/hint inline-flex align-middle" title={text}>
        {icon}
        <span className="sr-only">{text}</span>
      </span>
    );
  }

  return (
    <span className="group/hint inline-flex flex-col align-middle">
      <button
        type="button"
        title={text}
        aria-label={`说明：${text}`}
        aria-expanded={expanded}
        data-testid="field-hint-toggle"
        onClick={() => setExpanded((v) => !v)}
        className="cursor-help"
      >
        {icon}
      </button>
      {expanded && (
        <span
          role="note"
          data-testid="field-hint-note"
          className="mt-1 max-w-xs rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-2 py-1 text-xs leading-5 text-[hsl(var(--fg-muted))]"
        >
          {text}
        </span>
      )}
    </span>
  );
}
