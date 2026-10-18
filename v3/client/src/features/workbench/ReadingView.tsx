/**
 * B 沉浸阅读视图（设计 §7.1，交互自旧站 ReadingArea 移植）
 *
 * - 连续滚动：全部章节一条流；scrollTop<100 触底回调拉更早章节（§4.6 向上分页）
 * - 章节 = 带 chapter 元数据的 assistant 消息，按 index 升序分组渲染（标题锚点 chapter-{n}）
 * - 正文 markdown 管道：sanitizeMarkdownSource（DOMPurify，§9.3 第一层）
 *   + react-markdown + rehype-sanitize 默认 profile（第二层白名单兜底）
 * - 流式生成中：尾部呼吸占位块实时渲染 generationStore.buffer，接近底部时自动跟随
 * - 工具条：阅读模式 4 档 / 字号 4 档 / 行高 3 档（localStorage 持久化，见 readingPrefs）
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import type { Message } from '@shared/message';

import { readingColors, useReadingPrefs, FONT_SIZES, LINE_HEIGHTS, READING_MODES } from './readingPrefs';
import { sanitizeMarkdownSource } from './sanitize';

interface ReadingViewProps {
  messages: Message[];
  streaming: boolean;
  /** 流式缓冲（生成中尾部呼吸块实时内容） */
  buffer: string;
  hasMore: boolean;
  loadingOlder: boolean;
  /** 触底（scrollTop<100）请求更早章节 */
  onNeedOlder: () => void;
}

/** 正文 markdown 基础排版（Tailwind 任意变体，避免动 index.css——主题体系 Task 32 定型） */
const MARKDOWN_CLASS =
  '[&_p]:my-3 [&_h1]:my-4 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:my-4 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:my-3 [&_h3]:font-bold [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[hsl(var(--border-soft))] [&_blockquote]:pl-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:text-[hsl(var(--accent))] [&_a]:underline [&_hr]:my-4 [&_code]:rounded [&_code]:bg-[hsl(var(--surface))] [&_code]:px-1 [&_code]:text-[0.9em]';

/** 章节锚点 id（ChapterDrawer / 顶栏定位共用） */
export function chapterAnchorId(index: number): string {
  return `chapter-${index}`;
}

/** 单章分组：带 chapter 元数据的消息（novel 正文），按章号升序 */
function chapterMessages(messages: Message[]): Array<Message & { chapter: NonNullable<Message['chapter']> }> {
  return messages
    .filter((m): m is Message & { chapter: NonNullable<Message['chapter']> } => m.chapter !== undefined)
    .sort((a, b) => a.chapter.index - b.chapter.index);
}

/** 工具条按钮（选中态高亮，触控目标 ≥36px，旧站交互一致） */
function ToolbarButton({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-9 min-w-9 items-center justify-center rounded px-2 text-xs transition-colors ${
        active
          ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]'
          : 'text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]'
      }`}
    >
      {children}
    </button>
  );
}

export default function ReadingView({ messages, streaming, buffer, hasMore, loadingOlder, onNeedOlder }: ReadingViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { prefs, setMode, setFontSize, setLineHeight } = useReadingPrefs();
  // 流式跟随：用户主动上滚（距底 >300px）时暂停，重新滚回底部恢复
  const followRef = useRef(true);
  const chapters = useMemo(() => chapterMessages(messages), [messages]);
  const colors = readingColors(prefs.mode);

  // 流式内容增长时跟随滚动到底（用户上滚期间不打扰）
  useEffect(() => {
    if (!streaming || !followRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [buffer, streaming]);

  function handleScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 300;
    if (el.scrollTop < 100 && hasMore && !loadingOlder && !streaming) onNeedOlder();
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[hsl(var(--border-soft))] px-2 py-1">
      {READING_MODES.map((m) => (
        <ToolbarButton key={m.id} active={prefs.mode === m.id} title={m.label} onClick={() => setMode(m.id)}>
          {m.label}
        </ToolbarButton>
      ))}
      <span className="mx-1 hidden text-[hsl(var(--fg-muted))] sm:inline">|</span>
      {FONT_SIZES.map((f) => (
        <ToolbarButton key={f.id} active={prefs.fontSize === f.id} title={`字号：${f.label}`} onClick={() => setFontSize(f.id)}>
          {f.label}
        </ToolbarButton>
      ))}
      <span className="mx-1 hidden text-[hsl(var(--fg-muted))] sm:inline">|</span>
      {LINE_HEIGHTS.map((l) => (
        <ToolbarButton key={l.id} active={prefs.lineHeight === l.id} title={`行高：${l.label}`} onClick={() => setLineHeight(l.id)}>
          {l.label}
        </ToolbarButton>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="reading-scroll"
      >
        <div
          className="mx-auto max-w-3xl px-4 pb-10 pt-4 sm:px-6"
          style={{
            fontSize: `${prefs.fontSize}px`,
            lineHeight: prefs.lineHeight,
            ...(colors.bg ? { backgroundColor: colors.bg } : {}),
            ...(colors.fg ? { color: colors.fg } : {}),
          }}
        >
          {hasMore && (
            <p className="py-3 text-center text-xs text-[hsl(var(--fg-muted))]">
              {loadingOlder ? '正在加载更早章节…' : '继续向上滚动加载更早章节'}
            </p>
          )}

          {chapters.map((m) => (
            <article key={m.id} id={chapterAnchorId(m.chapter.index)} className="mb-10 scroll-mt-4">
              <h2 className="mb-4 text-xl font-bold">{m.chapter.title}</h2>
              <div className={MARKDOWN_CLASS}>
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                  {sanitizeMarkdownSource(m.content)}
                </ReactMarkdown>
              </div>
            </article>
          ))}

          {streaming && (
            <div className="mb-10 animate-pulse rounded-lg border border-dashed border-[hsl(var(--accent))] p-4 opacity-80">
              <div className={MARKDOWN_CLASS}>
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{sanitizeMarkdownSource(buffer)}</ReactMarkdown>
              </div>
              <p className="mt-3 flex items-center gap-2 text-xs text-[hsl(var(--accent))]">
                <span className="inline-block h-2 w-2 animate-ping rounded-full bg-[hsl(var(--accent))]" />
                正在生成…
              </p>
            </div>
          )}

          {!streaming && chapters.length === 0 && (
            <p className="py-16 text-center text-sm text-[hsl(var(--fg-muted))]">还没有章节</p>
          )}
        </div>
      </div>
    </div>
  );
}
