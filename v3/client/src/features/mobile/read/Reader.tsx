/**
 * 移动阅读器（/m/read/:id）——番茄式阅读交互（上线前阅读体验重做）
 *
 * - 点正文任意位置（含段落间空白）：从最近段落开始听书（播放中点别处=跳段）；选区优先划线
 * - 菜单：右下角 ☰ 浮动按钮呼出——上一/下一章 | 进度滑块（听书=段落进度可拖跳段）| 字号行距 | 目录
 * - 进度：章内百分比随滚动实时更新；位置（章节+滚动比例）写 localStorage，进入自动续读并提示
 * - 听书：按作品配音表分声 + 失败自动重试/跳段（toast 提示，不中断）；顶栏随菜单/听书显隐
 * - 保留：划线评论（文本快照锚）、批注列表、按类型总结、跳章上架语义（只渲染上架版本）
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, List } from 'lucide-react';

import { deleteComment, listComments, upsertComment } from '../../../api/comments';
import { getWork, listMessages } from '../../../api/works';
import { useAuthStore } from '../../../stores/auth';
import { uuid } from '../../../lib/uuid';
import type { Comment, CommentType } from '@shared/comment';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

import { useMobileTts } from '../useMobileTts';
import CatalogPanel from './CatalogPanel';
import CommentSummary from './CommentSummary';
import { CommentsSection, CommentSheet } from './CommentViews';
import ReaderMenu, { loadFont, saveFont, type ReaderFont } from './ReaderMenu';
import { HighlightedPara } from './ReaderParts';
import { snapshotQuote } from './reading-pos';
import { useReaderProgress } from './useReaderProgress';

type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };

/** 已上架章节视图：章节元信息 + 上架版本正文 */
interface PublishedChapter {
  msg: ChapterMsg;
  version: { id: string; name: string; content: string };
  paras: string[];
}

const COMMENT_TYPES: readonly CommentType[] = ['改错', '添加', '感悟'];

/** 稳定的空段落数组（无章时喂给 useMobileTts，保持引用稳定避免误停） */
const EMPTY_PARAS: readonly string[] = [];

export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const [work, setWork] = useState<Work | null>(null);
  const [chapters, setChapters] = useState<PublishedChapter[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<{ paraIndex: number; quote: string; raw: string } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // —— 听书（TTS）：按作品配音表分声，点段落即从该段播起 ——
  // —— 番茄式交互状态 ——
  const [menuOpen, setMenuOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [font, setFont] = useState<ReaderFont>(() => loadFont());
  // —— 听书 toast（非阻塞提示；失败自动跳段逻辑在 useMobileTts 内）——
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const articleRef = useRef<HTMLElement | null>(null);

  function notifyTts(message: string): void {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  function patchFont(patch: Partial<ReaderFont>): void {
    setFont((f) => {
      const next = { ...f, ...patch };
      saveFont(next);
      return next;
    });
  }

  useEffect(() => {
    if (!id) return;
    Promise.all([getWork(id), listMessages(id, { tail: 1000 }), listComments(id)])
      .then(([w, page, cs]) => {
        setWork(w);
        setComments(cs);
        const published: PublishedChapter[] = [];
        for (const m of page.messages) {
          const chapter = m.chapter;
          if (chapter === undefined || chapter.publishedVersionId == null) continue;
          const version = m.swipes.find((v) => v.id === chapter.publishedVersionId);
          if (!version) continue;
          published.push({ msg: m as ChapterMsg, version, paras: version.content.split('\n').filter((p) => p.trim() !== '') });
        }
        published.sort((a, b) => a.msg.chapter.index - b.msg.chapter.index);
        setChapters(published);
      })
      .catch(() => setLoadError(true));
  }, [id]);

  const { chapterIdx, jumpTo, scrollPct, resumeTip, hintOpen } = useReaderProgress(id, chapters, articleRef);
  const chapter = chapters[chapterIdx] ?? null;
  // 听书引擎：音色取作品配音表（旁白/角色分声），段落引用稳定、切章自动停止；失败跳段 toast 提示
  const tts = useMobileTts(chapter?.paras ?? EMPTY_PARAS, work?.voiceMap, notifyTts);
  const ttsIdx = tts.playingIdx;
  /** 当前章评论（版本不匹配的折叠为历史批注） */
  const chapterComments = useMemo(
    () => (chapter ? comments.filter((c) => c.chapterMsgId === chapter.msg.id) : []),
    [comments, chapter],
  );
  const activeComments = chapterComments.filter((c) => c.versionId === chapter?.version.id);

  /** 点击行为：正文区域内（含段落间空白）= 从最近段落开始听书；区域外保留左右 1/3 翻章；选区优先划线 */
  function handleReaderTap(e: React.MouseEvent<HTMLDivElement>): void {
    if (pending) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // 划线选区优先
    const article = articleRef.current;
    if (article && article.contains(e.target as Node)) {
      const paras = Array.from(article.querySelectorAll<HTMLElement>('[data-para-index]'));
      let best = -1;
      let bestDist = Infinity;
      for (const el of paras) {
        const r = el.getBoundingClientRect();
        const d = Math.abs(e.clientY - (r.top + r.height / 2));
        if (d < bestDist) {
          bestDist = d;
          best = Number(el.dataset.paraIndex);
        }
      }
      if (best >= 0) {
        void tts.playFrom(best);
        return;
      }
    }
    // 非正文区域：左右 1/3 翻章（菜单由右下角浮动按钮承载）
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 3) jumpTo(chapterIdx - 1);
    else if (x > (rect.width * 2) / 3) jumpTo(chapterIdx + 1);
  }

  /** 划线提交：在选区所在段落上取快照锚 */
  function handleSelection(): void {
    if (!chapter) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().trim();
    if (text.length < 2) return;
    const anchor = sel.anchorNode;
    const paras = document.querySelectorAll<HTMLElement>('[data-para-index]');
    for (const el of paras) {
      if (el.contains(anchor)) {
        const paraIndex = Number(el.dataset.paraIndex);
        const paraText = chapter.paras[paraIndex] ?? '';
        const start = paraText.indexOf(text);
        setPending({
          paraIndex,
          quote: start >= 0 ? snapshotQuote(paraText, start, start + text.length) : text.slice(0, 60),
          raw: text,
        });
        sel.removeAllRanges();
        return;
      }
    }
    sel.removeAllRanges();
  }

  async function submitComment(type: CommentType, note: string): Promise<void> {
    if (!chapter || !pending || !id) return;
    const me = useAuthStore.getState().user;
    const comment: Comment = {
      id: uuid(),
      ...(me ? { author: { uid: me.id, name: me.displayName || me.username } } : {}),
      chapterMsgId: chapter.msg.id,
      chapterIndex: chapter.msg.chapter.index,
      versionId: chapter.version.id,
      versionName: chapter.version.name,
      paraIndex: pending.paraIndex,
      quote: pending.quote,
      type,
      text: note,
      createdAt: Date.now(),
    };
    setComments((cs) => [...cs, comment]);
    setPending(null);
    try {
      await upsertComment(id, comment);
    } catch {
      setComments((cs) => cs.filter((c) => c.id !== comment.id));
      alert('评论保存失败，请重试');
    }
  }

  async function removeComment(cid: string): Promise<void> {
    if (!id) return;
    const prev = comments;
    setComments((cs) => cs.filter((c) => c.id !== cid));
    try {
      await deleteComment(id, cid);
    } catch {
      setComments(prev);
    }
  }

  function toggleTts(): void {
    if (tts.playing) tts.stop();
    else void tts.playFrom(0);
  }

  if (loadError) return <p className="py-24 text-center text-sm text-[hsl(var(--fg-muted))]">作品加载失败</p>;
  if (!work) return <p className="py-24 text-center text-sm text-[hsl(var(--fg-muted))]">加载中…</p>;
  if (chapters.length === 0)
    return (
      <div className="py-24 text-center text-sm text-[hsl(var(--fg-muted))]">
        <p>《{work.title}》暂无上架章节</p>
        <p className="mt-2 text-xs">去「创作」里上架章节后即可在此阅读</p>
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl pb-6" data-testid="reader">
      {/* 顶栏（菜单开启时显示；沉浸阅读时隐藏） */}
      <header
        className={`safe-top sticky top-0 z-10 flex items-center gap-2 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 py-2 transition-opacity ${
          menuOpen || ttsIdx >= 0 ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        data-testid="reader-topbar"
      >
        <button type="button" onClick={() => history.back()} className="text-sm" aria-label="返回书架">
          ←
        </button>
        <h1 className="m-serif min-w-0 flex-1 truncate text-sm font-semibold">{work.title}</h1>
        <button
          type="button"
          onClick={() => setCatalogOpen(true)}
          data-testid="catalog-open-btn"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[hsl(var(--border-soft))] px-2.5 text-xs"
        >
          <List className="h-4 w-4" aria-hidden />
          目录
        </button>
        <button
          type="button"
          onClick={() => setSummaryOpen(true)}
          data-testid="summary-open-btn"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[hsl(var(--border-soft))] px-2.5 text-xs"
        >
          <FileText className="h-4 w-4" aria-hidden />
          总结{comments.length > 0 && ` (${comments.length})`}
        </button>
        <button
          type="button"
          onClick={() => void toggleTts()}
          data-testid="tts-toggle-btn"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[hsl(var(--border-soft))] px-2.5 text-xs"
        >
          {ttsIdx >= 0 ? '⏹ 停止' : '🔊 听本章'}
        </button>
      </header>

      {/* 正文（点击分区 + 划线） */}
      <div className="m-reader-body" onMouseUp={handleSelection} onClick={handleReaderTap} data-testid="reader-body">
        <div className="flex gap-1.5 overflow-x-auto px-4 pt-3">
          {chapters.map((c, i) => (
            <button
              key={c.msg.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                jumpTo(i);
              }}
              className={`h-7 shrink-0 rounded-full border px-3 text-xs ${
                i === chapterIdx
                  ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
                  : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
              }`}
            >
              {c.msg.chapter.index}
            </button>
          ))}
        </div>

        {chapter && (
          <article
            className="bg-[hsl(var(--bg))] px-5 pb-6"
            ref={articleRef}
            style={{ fontSize: font.size, lineHeight: font.lineHeight }}
          >
            <div className="m-reader-ornament pt-6">
              <span className="m-serif">第 {chapter.msg.chapter.index} 章</span>
            </div>
            <h2 className="m-serif py-3 text-center text-xl font-semibold tracking-wide">
              {chapter.msg.chapter.title || '未命名'}
            </h2>
            <div className="m-reader-ornament pb-3">
              <span>❦</span>
            </div>
            {chapter.paras.map((para, i) => (
              <p key={i} data-para-index={i} className="py-2">
                <HighlightedPara para={para} comments={activeComments.filter((c) => c.paraIndex === i)} />
              </p>
            ))}
          </article>
        )}
      </div>

      {/* 操作引导（首次无记录时） */}
      {hintOpen && !resumeTip && (
        <div
          className="m-fade fixed left-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-center text-xs leading-5 text-white"
          data-testid="reader-hint"
        >
          点正文任意位置即从该处开始听书 · 右下角 ☰ 呼出菜单 · 选中文字可划线评论
        </div>
      )}

      {/* 右下角浮动菜单按钮（沉浸阅读时菜单/设置的唯一入口） */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        data-testid="reader-menu-fab"
        aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
        className="fixed bottom-6 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-lg text-white shadow-lg backdrop-blur-sm active:scale-95"
      >
        {menuOpen ? '✕' : '☰'}
      </button>

      {/* 听书提示 toast（合成失败跳段/停止等非阻塞消息） */}
      {toast && !resumeTip && (
        <div className="m-fade fixed left-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs text-white" data-testid="reader-tts-toast">
          {toast}
        </div>
      )}

      {/* 听书进行中提示 */}
      {ttsIdx >= 0 && (
        <div className="fixed left-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs text-white" data-testid="tts-playing-tip">
          🔊 正在朗读第 {ttsIdx + 1}/{chapter?.paras.length ?? 0} 段
        </div>
      )}

      {/* 续读提示 */}
      {resumeTip && (
        <div className="fixed left-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs text-white" data-testid="resume-tip">
          {resumeTip}
        </div>
      )}

      {/* 本章批注 + 划线评论浮层 */}
      {chapter && (
        <CommentsSection comments={chapterComments} versionId={chapter.version.id} onRemove={(cid) => void removeComment(cid)} />
      )}
      {pending && (
        <CommentSheet
          pending={pending}
          types={COMMENT_TYPES}
          onSubmit={(t, note) => void submitComment(t, note)}
          onDismiss={() => setPending(null)}
        />
      )}

      {/* 底部阅读菜单（右下角 ☰ 呼出）：滑块随听书状态切换段落/章节模式 + 字体设置 */}
      {menuOpen && chapter && (
        <ReaderMenu
          chapterNo={chapter.msg.chapter.index}
          lastChapterNo={chapters.at(-1)!.msg.chapter.index}
          chapterIdx={chapterIdx}
          total={chapters.length}
          scrollPct={scrollPct}
          onJump={jumpTo}
          onCatalog={() => setCatalogOpen(true)}
          onSummary={() => setSummaryOpen(true)}
          tts={ttsIdx >= 0 ? { paraIdx: ttsIdx, paraTotal: chapter.paras.length, onSeek: (i) => void tts.playFrom(i) } : undefined}
          font={font}
          onFontChange={patchFont}
        />
      )}

      {catalogOpen && (
        <CatalogPanel
          chapters={chapters.map((c) => ({ msgId: c.msg.id, index: c.msg.chapter.index, title: c.msg.chapter.title }))}
          currentIndex={chapterIdx}
          onPick={jumpTo}
          onClose={() => setCatalogOpen(false)}
        />
      )}
      {summaryOpen && <CommentSummary comments={comments} chapters={chapters} onClose={() => setSummaryOpen(false)} />}
    </div>
  );
}
