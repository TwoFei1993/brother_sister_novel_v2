/**
 * 移动阅读器（/m/read/:id）——番茄式阅读交互（上线前阅读体验重做）
 *
 * - 点击分区：左 1/3=上一章，中 1/3=呼出/隐藏菜单，右 1/3=下一章（有选区时优先划线，不触发）
 * - 菜单：底部面板 = 上一章 | 章节粒度进度滑块 | 下一章 + 目录入口；顶栏随菜单显隐（沉浸阅读）
 * - 进度：章内百分比随滚动实时更新；位置（章节+滚动比例）写 localStorage，进入自动续读并提示
 * - 保留：划线评论（文本快照锚）、批注列表、按类型总结、跳章上架语义（只渲染上架版本）
 * - 子模块：位置存取 reading-pos / 展示件 ReaderParts / 菜单 ReaderMenu / 批注视图 CommentViews
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

import CatalogPanel from './CatalogPanel';
import CommentSummary from './CommentSummary';
import { CommentsSection, CommentSheet } from './CommentViews';
import ReaderMenu from './ReaderMenu';
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

export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const [work, setWork] = useState<Work | null>(null);
  const [chapters, setChapters] = useState<PublishedChapter[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<{ paraIndex: number; quote: string; raw: string } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // —— 番茄式交互状态 ——
  const [menuOpen, setMenuOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const articleRef = useRef<HTMLElement | null>(null);

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
  /** 当前章评论（版本不匹配的折叠为历史批注） */
  const chapterComments = useMemo(
    () => (chapter ? comments.filter((c) => c.chapterMsgId === chapter.msg.id) : []),
    [comments, chapter],
  );
  const activeComments = chapterComments.filter((c) => c.versionId === chapter?.version.id);

  /** 番茄式点击分区：左 1/3 上一章 / 中 呼出菜单 / 右 1/3 下一章；有选区时让位给划线 */
  function handleReaderTap(e: React.MouseEvent<HTMLDivElement>): void {
    if (pending) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // 划线选区优先
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 3) jumpTo(chapterIdx - 1);
    else if (x > (rect.width * 2) / 3) jumpTo(chapterIdx + 1);
    else setMenuOpen((v) => !v);
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
          menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
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
          <article className="bg-[hsl(var(--bg))] px-5 pb-6" ref={articleRef}>
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
              <p key={i} data-para-index={i} className="py-2 text-[16px] leading-[2]">
                <HighlightedPara para={para} comments={activeComments.filter((c) => c.paraIndex === i)} />
              </p>
            ))}
          </article>
        )}
      </div>

      {/* 操作引导（首次无记录时） */}
      {hintOpen && !resumeTip && (
        <div
          className="fixed left-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-center text-xs leading-5 text-white"
          data-testid="reader-hint"
        >
          点击屏幕中间呼出菜单 · 左右两侧翻章 · 选中文字可划线评论
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

      {/* 底部阅读菜单（点中央呼出） */}
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
