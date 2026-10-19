/**
 * B 沉浸阅读视图（设计 §7.1，交互自旧站 ReadingArea 移植）
 *
 * - 连续滚动：全部章节一条流；scrollTop<100 触底回调拉更早章节（§4.6 向上分页）
 * - 章节 = 带 chapter 元数据的 assistant 消息，按 index 升序分组渲染（标题锚点 chapter-{n}）
 * - 正文 markdown 管道：sanitizeMarkdownSource（DOMPurify，§9.3 第一层）
 *   + react-markdown + rehype-sanitize 默认 profile（第二层白名单兜底）
 * - 流式生成中：尾部呼吸占位块实时渲染 generationStore.buffer，接近底部时自动跟随
 * - TTS 朗读高亮：播放中当前章按 voice-route 同源切分逐段渲染，当前段高亮并滚随
 *   （章序列与 WorkTtsBar 的连播队列同源同序，tts.chapterIndex 直接对齐本组件下标）
 * - 工具条：阅读模式 4 档 / 字号 4 档 / 行高 3 档（localStorage 持久化，见 readingPrefs）+ 导出 TXT
 */
import { useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import type { Message } from '@shared/message';
import type { TavernRegexScript } from '@shared/tavern';

import { applyDisplayRegex, MARKDOWN_CLASS } from '../../lib/markdown';
import { readingColors, useReadingPrefs, FONT_SIZES, LINE_HEIGHTS, READING_MODES } from '../../lib/readingPrefs';
import { sanitizeMarkdownSource } from '../../lib/sanitize';
import { splitParagraphs } from '../../lib/voice-route';
import { useTtsStore } from '../../stores/tts';

interface ReadingViewProps {
  messages: Message[];
  streaming: boolean;
  /** 流式缓冲（生成中尾部呼吸块实时内容） */
  buffer: string;
  /** 显示轨正则脚本（markdownOnly，§5.1②；WorkViewRouter 按 work 绑定拉取传入） */
  regexScripts?: TavernRegexScript[];
  hasMore: boolean;
  loadingOlder: boolean;
  /** 触底（scrollTop<100）请求更早章节 */
  onNeedOlder: () => void;
  /** 导出 TXT（宿主注入 exportTxt 调用；缺省不显示按钮） */
  onExportTxt?: () => void;
}

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

export default function ReadingView({
  messages,
  streaming,
  buffer,
  regexScripts,
  hasMore,
  loadingOlder,
  onNeedOlder,
  onExportTxt,
}: ReadingViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { prefs, setMode, setFontSize, setLineHeight } = useReadingPrefs();
  // 流式跟随：用户主动上滚（距底 >300px）时暂停，重新滚回底部恢复
  const followRef = useRef(true);
  const chapters = useMemo(() => chapterMessages(messages), [messages]);
  const colors = readingColors(prefs.mode);
  // TTS 播放态（store 全局共享；队列章序与本组件 chapters 同源同序）
  const tts = useTtsStore();
  const ttsActive = (tts.playing || tts.loading) && tts.currentIndex >= 0;

  // 流式内容增长时跟随滚动到底（用户上滚期间不打扰）
  useEffect(() => {
    if (!streaming || !followRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [buffer, streaming]);

  // 朗读段推进时滚随到当前高亮段（jsdom 无 scrollIntoView，可选调用兜底）
  useEffect(() => {
    if (!ttsActive) return;
    document
      .querySelector('[data-tts-active="true"]')
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [ttsActive, tts.chapterIndex, tts.currentIndex]);

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
      {onExportTxt && (
        <button
          type="button"
          title="导出 TXT"
          aria-label="导出 TXT"
          data-testid="export-txt"
          onClick={onExportTxt}
          className="ml-auto flex h-9 min-w-9 shrink-0 items-center justify-center rounded px-2 text-xs text-[hsl(var(--fg-muted))] transition-colors hover:text-[hsl(var(--fg))]"
        >
          ⬇ TXT
        </button>
      )}
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

          {chapters.map((m, ci) => {
            const highlightThis = ttsActive && ci === tts.chapterIndex;
            const paras = highlightThis ? splitParagraphs(m.content) : null;
            return (
              <article key={m.id} id={chapterAnchorId(m.chapter.index)} className="mb-10 scroll-mt-4">
                <h2 className="mb-4 text-xl font-bold">{m.chapter.title}</h2>
                {paras ? (
                  <div className={MARKDOWN_CLASS}>
                    {paras.map((p, pi) => (
                      <div
                        key={pi}
                        data-testid="tts-paragraph"
                        data-tts-active={pi === tts.currentIndex ? 'true' : 'false'}
                        className={`transition-colors ${
                          pi === tts.currentIndex
                            ? 'rounded-md border-l-2 border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 px-2 py-1'
                            : 'px-2 py-1'
                        }`}
                      >
                        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                          {sanitizeMarkdownSource(applyDisplayRegex(p, regexScripts))}
                        </ReactMarkdown>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={MARKDOWN_CLASS}>
                    <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                      {sanitizeMarkdownSource(applyDisplayRegex(m.content, regexScripts))}
                    </ReactMarkdown>
                  </div>
                )}
              </article>
            );
          })}

          {streaming && (
            <div className="mb-10 animate-pulse rounded-lg border border-dashed border-[hsl(var(--accent))] p-4 opacity-80">
              <div className={MARKDOWN_CLASS}>
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                  {sanitizeMarkdownSource(applyDisplayRegex(buffer, regexScripts))}
                </ReactMarkdown>
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
