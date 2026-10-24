/**
 * 移动创作分区：正文 / 大纲（占位）/ 资料（纯展示组件，编排见 MobileWork）
 *
 * - TextPane：章节选择 + 激活版本正文（就地编辑写回当前版本，PATCH 失败回滚）+ 指令生成下一章
 * - OutlinePane：对话大纲 Phase2 引导卡（桌面 /planner 承载完整向导）
 * - AssetsPane：作品设定摘要 + 章节大纲（高亮下一章节点）
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { patchMessage } from '../../../api/works';
import { useWorkStore } from '../../../stores/work';
import type { DetectedAsset, Message } from '@shared/message';
import type { Work } from '@shared/work';
import type { UseGenerateResult } from '../../../hooks/useGenerate';

import { confirmPendingAsset } from './pending-assets';
import OutlineIterChat from './OutlineIterChat';

type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };
type Gen = Pick<UseGenerateResult, 'streaming' | 'buffer' | 'partialKept' | 'error' | 'clearError' | 'generateChapter' | 'continueFromPartial' | 'swipeRegenerate' | 'thinkingBuffer'>;

/** 章节选择条：横向滚动 chips，选中高亮 */
export function ChapterChips({
  chapters,
  currentId,
  onPick,
}: {
  chapters: readonly ChapterMsg[];
  currentId: string | undefined;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto px-4 py-2" data-testid="chapter-chips">
      {chapters.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          className={`h-7 shrink-0 rounded-full border px-3 text-xs ${
            c.id === currentId
              ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
              : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
          }`}
        >
          {c.chapter.index} · {c.chapter.title || '未命名'}
        </button>
      ))}
    </div>
  );
}

export function TextPane({
  work,
  chapters,
  current,
  gen,
  onPick,
  onDone,
}: {
  work: Work;
  chapters: readonly ChapterMsg[];
  current: ChapterMsg | null;
  gen: Gen;
  onPick: (id: string) => void;
  onDone: (msg: Message | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [directive, setDirective] = useState('');
  /** 待绑定确认队列：本章生成检出的新素材（D8 side-channel） */
  const [pendingList, setPendingList] = useState<DetectedAsset[]>([]);

  /** 🎲 重roll当前章（同指令追加新版本，旧版本保留；上下文=该章之前的历史） */
  async function rerollCurrent(): Promise<void> {
    if (!current || gen.streaming) return;
    onDone(await gen.swipeRegenerate(work, useWorkStore.getState().messages, current));
  }
  /** 章切换时同步检出清单（取当前章的 extra.newAssets） */
  useEffect(() => {
    setPendingList(current?.extra.newAssets ?? []);
  }, [current?.id, current?.extra.newAssets]);

  async function confirmAsset(d: DetectedAsset): Promise<void> {
    try {
      await confirmPendingAsset(work, d, current?.chapter.index ?? 1);
      setPendingList((l) => l.filter((x) => x !== d));
    } catch {
      alert('素材入库失败，请重试');
    }
  }

  function startEdit(): void {
    if (!current) return;
    setDraft(current.content);
    setEditing(true);
  }

  /** 保存写回当前激活版本（与桌面 handleEditContent 同语义：本地乐观 + PATCH 失败回滚） */
  async function saveEdit(): Promise<void> {
    if (!current) return;
    const updated: Message = {
      ...current,
      content: draft,
      swipes: current.swipes.map((v, i) => (i === current.swipeId ? { ...v, content: draft } : v)),
    };
    useWorkStore.getState().upsertLocal(updated);
    setEditing(false);
    try {
      await patchMessage(work.id, updated);
    } catch {
      console.warn('[MobileWork] 正文保存持久化失败，已回滚');
      useWorkStore.getState().upsertLocal(current);
    }
  }

  async function generate(): Promise<void> {
    if (gen.streaming) return;
    const d = directive.trim();
    setDirective('');
    // 空指令=自动续写（同 ⚡连写语义：仅写作要求；绑定了章节大纲时本章要点仍自动注入）
    onDone(await gen.generateChapter(work, useWorkStore.getState().messages, d));
  }

  return (
    <div className="pb-4">
      <ChapterChips chapters={chapters} currentId={current?.id} onPick={onPick} />

      {gen.error && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl border border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/10 px-3 py-2 text-xs text-[hsl(var(--danger))]">
          <span className="min-w-0 flex-1">{gen.error.message}</span>
          <button type="button" onClick={gen.clearError} className="shrink-0 underline">
            知道了
          </button>
        </div>
      )}

      {/* 激活版本正文 */}
      {current && (
        <div className="mx-4 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              第{current.chapter.index}章 {current.chapter.title || '未命名'}
            </h2>
            {!editing && !gen.streaming && (
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void rerollCurrent()}
                  title="同指令重写本章，追加为新版本（旧版本保留）"
                  data-testid="mobile-reroll-btn"
                  className="text-xs text-[hsl(var(--accent))]"
                >
                  🎲 重roll
                </button>
                <button type="button" onClick={startEdit} className="text-xs text-[hsl(var(--accent))]" data-testid="mobile-edit-btn">
                  ✏️ 编辑
                </button>
              </span>
            )}
            {editing && (
              <span className="flex gap-2">
                <button type="button" onClick={() => void saveEdit()} className="text-xs text-[hsl(var(--accent))]" data-testid="mobile-save-btn">
                  保存
                </button>
                <button type="button" onClick={() => setEditing(false)} className="text-xs text-[hsl(var(--fg-muted))]">
                  取消
                </button>
              </span>
            )}
          </div>
          {editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={16}
              data-testid="mobile-edit-area"
              className="w-full resize-y rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-3 text-sm leading-7 outline-none focus:border-[hsl(var(--accent))]"
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-7">{current.content}</p>
          )}
        </div>
      )}

      {/* 流式生成中（DeepSeek 式）：💭思考可折叠 + 正文接着文章位置内联续写 */}
      {gen.streaming && (
        <div className="mx-4 mt-3" data-testid="mobile-streaming">
          {gen.thinkingBuffer && <ThinkingInline text={gen.thinkingBuffer} done={Boolean(gen.buffer)} />}
          <div className="rounded-xl border border-[hsl(var(--accent))]/40 bg-[hsl(var(--surface))] p-4">
            <p className="mb-1 text-xs text-[hsl(var(--accent))]">
              <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--accent))]" />
              AI 续写中（第{chapters.length + 1}章）…
            </p>
            <p className="m-reader-body whitespace-pre-wrap text-[15px] leading-8">{gen.buffer || '（思考中，正文即将开始…）'}</p>
          </div>
          {gen.partialKept && (
            <button
              type="button"
              onClick={() => void gen.continueFromPartial(work, useWorkStore.getState().messages, gen.buffer).then(onDone)}
              className="mt-2 h-8 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs"
            >
              ⏵ 接着写
            </button>
          )}
        </div>
      )}

      {/* 待绑定确认（D8）：本章检出的新角色/势力/世界观 */}
      {pendingList.length > 0 && (
        <div className="mx-4 mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3" data-testid="pending-assets">
          <p className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            🧩 本章检出 {pendingList.length} 个新素材，确认后入库并绑定到本书
          </p>
          <ul className="flex flex-col gap-1.5">
            {pendingList.map((d) => (
              <li key={d.name} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{d.name}</span>
                  <span className="ml-1 text-[hsl(var(--fg-muted))]">
                    （{d.kind === 'character' ? '角色' : d.kind === 'faction' ? '势力' : '世界观'}）{d.summary.slice(0, 24)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void confirmAsset(d)}
                  data-testid={`confirm-asset-${d.name}`}
                  className="shrink-0 rounded-lg border border-amber-500/50 px-2 py-1 text-amber-700 dark:text-amber-400"
                >
                  入库并绑定
                </button>
                <button
                  type="button"
                  onClick={() => setPendingList((l) => l.filter((x) => x !== d))}
                  className="shrink-0 rounded-lg px-2 py-1 text-[hsl(var(--fg-muted))]"
                >
                  忽略
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 写下一章 */}
      <div className="mx-4 mt-3 flex gap-2">
        <input
          value={directive}
          onChange={(e) => setDirective(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void generate()}
          placeholder={chapters.length === 0 ? '第一章剧情指令（留空=自由发挥）' : `第${chapters.length + 1}章指令（留空=自动续写）`}
          disabled={gen.streaming}
          data-testid="mobile-directive-input"
          className="h-11 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void generate()}
          disabled={gen.streaming}
          data-testid="mobile-generate-btn"
          className="h-11 shrink-0 rounded-xl bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
        >
          {directive.trim() ? '✨ 生成' : '⏩ 续写'}
        </button>
      </div>
    </div>
  );
}

/** 大纲分区：对话大纲·迭代聊天（P2.3）——聊某章怎么改→确认→生成新版本；建书向导仍在桌面 /planner */
export function OutlinePane({
  work,
  chapters,
  onDone,
}: {
  work: Work;
  chapters: readonly ChapterMsg[];
  onDone: (msg: Message) => void;
}) {
  if (chapters.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-3xl">🗺️</p>
        <p className="mt-3 text-sm font-medium">对话大纲</p>
        <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[hsl(var(--fg-muted))]">
          先在「正文」分区写第一章，之后就能在这里和助手聊任何一章的修改。
        </p>
        <Link
          to="/planner"
          className="mt-4 inline-flex h-10 items-center rounded-xl border border-[hsl(var(--border-soft))] px-5 text-sm"
        >
          新书策划向导（桌面版）↗
        </Link>
      </div>
    );
  }
  return <OutlineIterChat work={work} chapters={chapters.map((msg) => ({ msg }))} onDone={onDone} />;
}

/** 资料分区：作品设定摘要 + 章节大纲（高亮下一章=本章所在节点） */
export function AssetsPane({ work, nextIndex }: { work: Work; nextIndex: number }) {
  const s = work.settings;
  const outlines = s.chapterOutlines ?? [];
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <section className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
        <h2 className="mb-2 text-sm font-semibold">作品设定</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs leading-5">
          <dt className="text-[hsl(var(--fg-muted))]">题材</dt>
          <dd>{s.subGenre || s.genre}</dd>
          <dt className="text-[hsl(var(--fg-muted))]">核心矛盾</dt>
          <dd className="whitespace-pre-wrap">{s.coreConflict || '—'}</dd>
          <dt className="text-[hsl(var(--fg-muted))]">力量体系</dt>
          <dd className="whitespace-pre-wrap">{s.powerSystem || '—'}</dd>
          <dt className="text-[hsl(var(--fg-muted))]">基调</dt>
          <dd>{s.storyTones.join(' / ') || '—'}</dd>
        </dl>
      </section>

      <section className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
        <h2 className="mb-2 text-sm font-semibold">章节大纲</h2>
        {outlines.length === 0 && (
          <p className="text-xs text-[hsl(var(--fg-muted))]">暂无章节大纲（可在桌面版一键导入或对话大纲生成）</p>
        )}
        <ol className="flex flex-col gap-1.5">
          {outlines.map((o) => {
            const active = o.index === nextIndex;
            return (
              <li
                key={o.index}
                className={`rounded-lg px-3 py-2 text-xs leading-5 ${
                  active ? 'border border-[hsl(var(--accent))]/50 bg-[hsl(var(--accent))]/10' : ''
                }`}
              >
                <span className={active ? 'font-medium text-[hsl(var(--accent))]' : 'font-medium'}>
                  第{o.index}章 {o.title}
                </span>
                {active && <span className="ml-1.5 text-[10px] text-[hsl(var(--accent))]">← 下一章</span>}
                <p className="mt-0.5 text-[hsl(var(--fg-muted))]">{o.plot}</p>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

/** 💭 思考折叠块（DeepSeek 式）：流式中默认展开跟随思考，正文开始后自动收起为一行 */
function ThinkingInline({ text, done }: { text: string; done: boolean }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (done) setOpen(false);
  }, [done]);
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="mobile-thinking-toggle"
        className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-[hsl(var(--fg-muted))]"
      >
        <span aria-hidden>💭</span>
        {done ? '已深度思考（点击展开）' : '深度思考中…'}
        <span className="ml-auto">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="max-h-56 overflow-y-auto px-3 pb-2 text-xs leading-5 whitespace-pre-wrap text-[hsl(var(--fg-muted))]">
          {text.slice(-2000)}
        </div>
      )}
    </div>
  );
}
