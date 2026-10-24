/**
 * 移动阅读器（/m/read/:id）——番茄式阅读交互（上线前阅读体验重做）
 *
 * - 点击分区：左 1/3=上一章，中 1/3=呼出/隐藏菜单，右 1/3=下一章（有选区时优先划线，不触发）
 * - 菜单：底部面板 = 上一章 | 章节粒度进度滑块 | 下一章 + 目录入口；顶栏随菜单显隐（沉浸阅读）
 * - 进度：章内百分比随滚动实时更新；位置（章节+滚动比例）写 localStorage，进入自动续读并提示
 * - 保留：划线评论（文本快照锚）、批注列表、按类型总结、跳章上架语义（只渲染上架版本）
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { deleteComment, listComments, upsertComment } from '../../../api/comments';
import { getWork, listMessages } from '../../../api/works';
import { useAuthStore } from '../../../stores/auth';
import { uuid } from '../../../lib/uuid';
import type { Comment, CommentType } from '@shared/comment';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

import CatalogPanel from './CatalogPanel';
import CommentSummary from './CommentSummary';

type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };

/** 已上架章节视图：章节元信息 + 上架版本正文 */
interface PublishedChapter {
  msg: ChapterMsg;
  version: { id: string; name: string; content: string };
  paras: string[];
}

const COMMENT_TYPES: readonly CommentType[] = ['改错', '添加', '感悟'];
const POS_KEY = 'm-reading-pos-v1';

interface SavedPos {
  chapterMsgId: string;
  ratio: number;
}

function loadPos(workId: string): SavedPos | null {
  try {
    const map = JSON.parse(localStorage.getItem(POS_KEY) ?? '{}') as Record<string, SavedPos>;
    const p = map[workId];
    return p && typeof p.chapterMsgId === 'string' ? p : null;
  } catch {
    return null;
  }
}

function savePos(workId: string, pos: SavedPos): void {
  try {
    const map = JSON.parse(localStorage.getItem(POS_KEY) ?? '{}') as Record<string, SavedPos>;
    map[workId] = pos;
    localStorage.setItem(POS_KEY, JSON.stringify(map));
  } catch {
    /* 隐私模式等场景静默 */
  }
}

/** 引用快照截断：前后各留 12 字上下文（提高段落内唯一性，控制存储） */
function snapshotQuote(text: string, start: number, end: number): string {
  const s = Math.max(0, start - 12);
  const e = Math.min(text.length, end + 12);
  return text.slice(s, e);
}

export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const [work, setWork] = useState<Work | null>(null);
  const [chapters, setChapters] = useState<PublishedChapter[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [pending, setPending] = useState<{ paraIndex: number; quote: string; raw: string } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // —— 番茄式交互状态 ——
  const [menuOpen, setMenuOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [resumeTip, setResumeTip] = useState<string | null>(null);
  const [scrollPct, setScrollPct] = useState(0);
  const articleRef = useRef<HTMLElement | null>(null);
  const resumeDoneRef = useRef(false);

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

  const chapter = chapters[chapterIdx] ?? null;
  /** 当前章评论（版本不匹配的折叠为历史批注） */
  const chapterComments = useMemo(
    () => (chapter ? comments.filter((c) => c.chapterMsgId === chapter.msg.id) : []),
    [comments, chapter],
  );
  const activeComments = chapterComments.filter((c) => c.versionId === chapter?.version.id);

  // —— 续读：章节加载后恢复上次位置（一次性） ——
  useEffect(() => {
    if (resumeDoneRef.current || chapters.length === 0 || !id) return;
    resumeDoneRef.current = true;
    const saved = loadPos(id);
    const idx = saved ? chapters.findIndex((c) => c.msg.id === saved.chapterMsgId) : -1;
    if (idx >= 0) {
      setChapterIdx(idx);
      setResumeTip(`已续读至 第${chapters[idx]!.msg.chapter.index}章`);
      setTimeout(() => setResumeTip(null), 2600);
      requestAnimationFrame(() => {
        const main = articleRef.current?.closest('main');
        const ratio = Math.min(0.95, Math.max(0, saved!.ratio));
        if (main) main.scrollTop = main.scrollHeight * ratio;
      });
    }
  }, [chapters, id]);

  // —— 滚动监听：章内百分比 + 节流保存位置 ——
  useEffect(() => {
    const main = articleRef.current?.closest('main');
    if (!main) return;
    let last = 0;
    const onScroll = (): void => {
      const max = main.scrollHeight - main.clientHeight;
      const ratio = max > 0 ? main.scrollTop / max : 0;
      setScrollPct(Math.round(ratio * 100));
      const now = Date.now();
      if (now - last < 500) return;
      last = now;
      const cur = chapters[chapterIdx];
      if (cur && id) savePos(id, { chapterMsgId: cur.msg.id, ratio });
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, [chapters, chapterIdx, id]);

  function jumpTo(idx: number): void {
    const n = chapters.length;
    if (n === 0) return;
    const next = Math.max(0, Math.min(n - 1, idx));
    setChapterIdx(next);
    requestAnimationFrame(() => articleRef.current?.scrollIntoView({ block: 'start' }));
    const cur = chapters[next];
    if (cur && id) savePos(id, { chapterMsgId: cur.msg.id, ratio: 0 });
  }

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
          className="h-8 rounded-lg border border-[hsl(var(--border-soft))] px-2.5 text-xs"
        >
          ☰ 目录
        </button>
        <button
          type="button"
          onClick={() => setSummaryOpen(true)}
          data-testid="summary-open-btn"
          className="h-8 rounded-lg border border-[hsl(var(--border-soft))] px-2.5 text-xs"
        >
          📝 总结{comments.length > 0 && ` (${comments.length})`}
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

      {/* 续读提示 */}
      {resumeTip && (
        <div className="fixed left-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs text-white" data-testid="resume-tip">
          {resumeTip}
        </div>
      )}

      {/* 本章批注（含历史版本折叠） */}
      {chapter && chapterComments.length > 0 && (
        <section className="mx-5 mb-6 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
          <h3 className="mb-2 text-xs font-semibold text-[hsl(var(--fg-muted))]">本章批注（{chapterComments.length}）</h3>
          <ul className="flex flex-col gap-2">
            {chapterComments.map((c) => {
              const stale = c.versionId !== chapter.version.id;
              return (
                <li key={c.id} className={`rounded-lg px-3 py-2 text-xs ${stale ? 'opacity-60' : ''}`} data-testid="reader-comment">
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="rounded-full bg-[hsl(var(--accent))]/10 px-1.5 text-[10px] text-[hsl(var(--accent))]">{c.type}</span>
                    <span className="text-[10px] text-[hsl(var(--fg-muted))]">
                      {c.author?.name ?? '作者'} · v{c.versionName}
                      {stale && ' · 原文已变'}
                    </span>
                    <button type="button" onClick={() => void removeComment(c.id)} className="ml-auto text-[10px] text-[hsl(var(--fg-muted))] underline">
                      删除
                    </button>
                  </div>
                  <p className="text-[hsl(var(--fg-muted))]">「{c.quote.length > 40 ? `${c.quote.slice(0, 40)}…` : c.quote}」</p>
                  {c.text && <p className="mt-0.5">{c.text}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 划线评论浮层 */}
      {pending && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setPending(null)}>
          <div
            className="w-full rounded-t-2xl bg-[hsl(var(--surface))] p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
            data-testid="comment-sheet"
          >
            <p className="mb-3 line-clamp-2 text-xs text-[hsl(var(--fg-muted))]">
              「{pending.raw.slice(0, 60)}
              {pending.raw.length > 60 ? '…' : ''}」
            </p>
            <div className="mb-3 flex gap-2">
              {COMMENT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => void submitComment(t, '')}
                  className="h-10 flex-1 rounded-xl border border-[hsl(var(--border-soft))] text-sm"
                >
                  {t}
                </button>
              ))}
            </div>
            <CommentNoteInput onSubmit={(note) => void submitComment('感悟', note)} />
          </div>
        </div>
      )}

      {/* 底部阅读菜单（点中央呼出）：上一章 | 进度滑块 | 下一章 + 章内百分比 */}
      {menuOpen && chapter && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]/95 px-4 pb-3 pt-3 backdrop-blur-sm" data-testid="reader-menu">
          <div className="mb-2 flex items-center justify-between text-xs text-[hsl(var(--fg-muted))]" data-testid="reader-progress">
            <span>
              第 {chapter.msg.chapter.index}/{chapters.at(-1)?.msg.chapter.index} 章
            </span>
            <span>本章 {scrollPct}%</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => jumpTo(chapterIdx - 1)}
              disabled={chapterIdx <= 0}
              data-testid="reader-prev-chapter"
              className="h-9 shrink-0 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs disabled:opacity-40"
            >
              上一章
            </button>
            <input
              type="range"
              min={0}
              max={chapters.length - 1}
              value={chapterIdx}
              onChange={(e) => jumpTo(Number(e.target.value))}
              data-testid="reader-progress-slider"
              aria-label="章节进度"
              className="h-1.5 min-w-0 flex-1 accent-[hsl(var(--accent))]"
            />
            <button
              type="button"
              onClick={() => jumpTo(chapterIdx + 1)}
              disabled={chapterIdx >= chapters.length - 1}
              data-testid="reader-next-chapter"
              className="h-9 shrink-0 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs disabled:opacity-40"
            >
              下一章
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setCatalogOpen(true)}
              data-testid="menu-catalog-btn"
              className="h-9 flex-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs"
            >
              ☰ 目录
            </button>
            <button
              type="button"
              onClick={() => setSummaryOpen(true)}
              className="h-9 flex-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs"
            >
              📝 评论总结
            </button>
          </div>
        </div>
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

/** 段内高亮：quote 去上下文核心匹配尽力而为；匹配不到原样渲染（失效标记在批注列表） */
function HighlightedPara({ para, comments }: { para: string; comments: readonly Comment[] }) {
  let nodes: React.ReactNode = para;
  for (const c of comments) {
    const probe = c.quote.length > 24 ? c.quote.slice(8, 20) : c.quote.slice(0, Math.min(12, c.quote.length));
    const idx = para.indexOf(probe);
    if (idx < 0) continue;
    const start = Math.max(0, idx - 8);
    const end = Math.min(para.length, idx + probe.length + 8);
    nodes = (
      <>
        {para.slice(0, start)}
        <mark className="rounded bg-amber-300/40 px-0.5 dark:bg-amber-500/30" data-testid="highlight">
          {para.slice(start, end)}
        </mark>
        {para.slice(end)}
      </>
    );
    break;
  }
  return <>{nodes}</>;
}

/** 备注输入（可选）：感悟常带正文，改错/添加直接点类型即可 */
function CommentNoteInput({ onSubmit }: { onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <div className="flex gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="补充备注（可选）"
        data-testid="comment-note-input"
        className="h-10 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
      />
      <button
        type="button"
        onClick={() => note.trim() && onSubmit(note.trim())}
        disabled={!note.trim()}
        className="h-10 rounded-xl bg-[hsl(var(--accent))] px-4 text-sm text-[hsl(var(--accent-fg))] disabled:opacity-40"
      >
        发感悟
      </button>
    </div>
  );
}
