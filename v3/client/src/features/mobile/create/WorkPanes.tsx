/**
 * 移动创作分区：正文 / 大纲（占位）/ 资料（纯展示组件，编排见 MobileWork）
 *
 * - TextPane：章节选择 + 激活版本正文（就地编辑写回当前版本，PATCH 失败回滚）+ 指令生成下一章
 * - OutlinePane：对话大纲 Phase2 引导卡（桌面 /planner 承载完整向导）
 * - AssetsPane：作品设定摘要 + 章节大纲（高亮下一章节点）
 */
import { useEffect, useState } from 'react';
import { BookOpen, Brain, Dices, Map, SquarePen, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

import { apiFetch } from '../../../api/client';
import { generateTextOnce } from '../../../api/llm';
import { patchMessage, updateWork, upsertMessage } from '../../../api/works';
import { useWorkStore } from '../../../stores/work';
import { useSettingsStore } from '../../../stores/settings';
import { appendSwipe, buildChapterMessage } from '../../../hooks/generation-flow';
import { chapterChip, chapterTitle } from '../../../lib/chapter-title';
import type { DetectedAsset, Message } from '@shared/message';
import type { Work } from '@shared/work';
import type { UseGenerateResult } from '../../../hooks/useGenerate';

import { confirmPendingAsset } from './pending-assets';
import MobileTtsBar from './MobileTtsBar';
import OutlineIterChat from './OutlineIterChat';

type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };
type Gen = Pick<UseGenerateResult, 'streaming' | 'buffer' | 'partialKept' | 'error' | 'clearError' | 'generateChapter' | 'continueFromPartial' | 'swipeRegenerate' | 'thinkingBuffer' | 'runBatch' | 'runByOutline' | 'batch'>;

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
          {chapterChip(c.chapter.index, c.chapter.title)}
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
  /** 共享入库：勾选后本次检出的素材不归属本书（跨书可见的共享卡） */
  const [sharedImport, setSharedImport] = useState(false);
  /** ✨ AI 润色进行中（生成新版本） */
  const [polishing, setPolishing] = useState(false);

  /** 🎲 重roll当前章（同指令追加新版本，旧版本保留；上下文=该章之前的历史） */
  const [rerollTarget, setRerollTarget] = useState<ChapterMsg | null>(null);
  async function rerollCurrent(): Promise<void> {
    if (!current || gen.streaming) return;
    setRerollTarget(current);
    const msg = await gen.swipeRegenerate(work, useWorkStore.getState().messages, current);
    setRerollTarget(null);
    onDone(msg);
  }
  /** 章切换时同步检出清单（取当前章的 extra.newAssets） */
  useEffect(() => {
    setPendingList(current?.extra.newAssets ?? []);
  }, [current?.id, current?.extra.newAssets]);

  async function confirmAsset(d: DetectedAsset): Promise<void> {
    try {
      await confirmPendingAsset(work, d, current?.chapter.index ?? 1, sharedImport);
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

  /** ✍️ 手写第一章（自己写/粘贴正文，写完可 AI 润色）：建空章节并直接进入编辑态 */
  async function createHandwriteChapter(): Promise<void> {
    if (gen.streaming) return;
    const msg = buildChapterMessage({ content: '', title: '', chapterIndex: 1, promptTokens: 0, generationMs: 0 });
    try {
      await upsertMessage(work.id, msg);
      useWorkStore.getState().upsertLocal(msg);
      onPick(msg.id);
      setDraft('');
      setEditing(true);
    } catch {
      alert('创建章节失败，请重试');
    }
  }

  /** ✨ AI 润色当前章：保持情节/人物/事实不变提升文笔，生成新版本（旧版本保留） */
  async function polishCurrent(): Promise<void> {
    if (!current || polishing || gen.streaming) return;
    if (!current.content.trim()) return;
    if (!confirm('AI 润色：保持情节与人物不变，提升文笔与节奏，生成新版本（当前版本保留）。继续？')) return;
    setPolishing(true);
    try {
      const prefs = useSettingsStore.getState().llmPrefs;
      const text = await generateTextOnce(
        {
          source: prefs.source,
          model: prefs.model,
          temperature: 0.6,
          thinking: prefs.thinking !== false,
          messages: [
            {
              role: 'user',
              content:
                `你是资深小说编辑。请在完全不改变以下章节的情节走向、人物性格、对话内容与事实设定的前提下润色正文：` +
                `修正病句与错别字、提升文字质感与画面感、优化叙事节奏。直接输出润色后的全文，不要任何解释、标题或前后缀。` +
                `\n\n【章节】第${current.chapter.index}章 ${current.chapter.title || ''}\n\n【正文】\n${current.content}`,
            },
          ],
        },
        16384,
      );
      const cleaned = text.trim();
      if (!cleaned) throw new Error('模型无输出');
      const updated = appendSwipe(current, cleaned, {});
      useWorkStore.getState().upsertLocal(updated);
      await patchMessage(work.id, updated);
    } catch (err) {
      alert(`润色失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setPolishing(false);
    }
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

      {/* 激活版本正文（标题独占一行；操作按钮等宽一行不折行——窄屏竖排折行反馈修复） */}
      {current && (
        <div className="mx-4 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
          <h2 className="truncate text-sm font-semibold">
            {chapterTitle(current.chapter.index, current.chapter.title)}
          </h2>
          {!editing && !gen.streaming && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void polishCurrent()}
                disabled={polishing || !current.content.trim()}
                title="保持情节不变提升文笔，生成新版本（旧版本保留）"
                data-testid="mobile-polish-btn"
                className="flex h-8 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--accent))] disabled:opacity-40"
              >
                ✨ 润色
              </button>
              <button
                type="button"
                onClick={() => void rerollCurrent()}
                title="同指令重写本章，追加为新版本（旧版本保留）"
                data-testid="mobile-reroll-btn"
                className="flex h-8 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--accent))]"
              >
                <Dices className="h-4 w-4" aria-hidden />
                重roll
              </button>
              <button
                type="button"
                onClick={startEdit}
                data-testid="mobile-edit-btn"
                className="flex h-8 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--accent))]"
              >
                <SquarePen className="h-4 w-4" aria-hidden />
                编辑
              </button>
            </div>
          )}
          {editing && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void saveEdit()}
                data-testid="mobile-save-btn"
                className="h-8 flex-1 whitespace-nowrap rounded-lg bg-[hsl(var(--accent))] text-xs font-medium text-[hsl(var(--accent-fg))]"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-8 flex-1 whitespace-nowrap rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg-muted))]"
              >
                取消
              </button>
            </div>
          )}
          <div className="mt-2">
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
        </div>
      )}

      {/* 听书条：按作品配音表分声朗读当前章（音色在「资料」分区配置） */}
      {current && !editing && !gen.streaming && <MobileTtsBar chapter={current} voiceMap={work.voiceMap} />}

      {/* ✨ AI 润色进行中（单行居中状态） */}
      {polishing && (
        <p className="flex items-center justify-center gap-1.5 py-2 text-xs text-[hsl(var(--accent))]" data-testid="polishing-line">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--accent))]" />
          AI 润色中（保持情节不变，完成后生成新版本）…
        </p>
      )}

      {/* 流式生成中（DeepSeek 式）：💭思考可折叠 + 正文接着文章位置内联续写；状态行固定单行居中 */}
      {gen.streaming && (
        <div className="mx-4 mt-3" data-testid="mobile-streaming">
          {gen.thinkingBuffer && (
            <ThinkingInline text={gen.thinkingBuffer} done={Boolean(gen.buffer)} startCollapsed={Boolean(rerollTarget)} />
          )}
          <div className="rounded-xl border border-[hsl(var(--accent))]/40 bg-[hsl(var(--surface))] p-4">
            <p className="mb-1 flex items-center justify-center gap-1.5 text-xs text-[hsl(var(--accent))]">
              <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-[hsl(var(--accent))]" />
              <span className="truncate">
                {rerollTarget ? `AI 重写第${rerollTarget.chapter.index}章（生成新版本）…` : `AI 续写中（第${chapters.length + 1}章）…`}
              </span>
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
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              本章检出 {pendingList.length} 个新素材，确认后入库并绑定到本书
            </p>
            <label className="flex shrink-0 items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <input
                type="checkbox"
                checked={sharedImport}
                onChange={(e) => setSharedImport(e.target.checked)}
                data-testid="shared-import-check"
              />
              共享入库
            </label>
          </div>
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

      {/* ✍️ 手写第一章（自己写/粘贴，写完可 AI 润色） */}
      {chapters.length === 0 && !gen.streaming && (
        <button
          type="button"
          onClick={() => void createHandwriteChapter()}
          data-testid="handwrite-chapter-btn"
          className="mx-4 mb-2 flex h-11 w-[calc(100%-2rem)] items-center justify-center gap-1.5 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] text-xs"
        >
          ✍️ 手写第一章（自己写 / 粘贴正文，写完可 AI 润色）
        </button>
      )}

      {/* 批量生成：⚡连写（写到目标章数）/ 📖按大纲（有大纲时） */}
      <div className="mx-4 mb-2 flex gap-2">
        <button
          type="button"
          onClick={() => void gen.runBatch(work, directive.trim() || '自由发挥第一章').then(() => setDirective(''))}
          disabled={gen.streaming || Boolean(gen.batch)}
          data-testid="mobile-batch-btn"
          className="h-9 flex-1 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] text-xs disabled:opacity-40"
        >
          <Zap className="h-4 w-4" aria-hidden />
          一键连写
        </button>
        <button
          type="button"
          onClick={() => void gen.runByOutline(work, useWorkStore.getState().messages)}
          disabled={gen.streaming || Boolean(gen.batch)}
          data-testid="mobile-outline-run-btn"
          className="h-9 flex-1 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] text-xs disabled:opacity-40"
        >
          <BookOpen className="h-4 w-4" aria-hidden />
          按大纲写
        </button>
      </div>

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
          {directive.trim() ? '生成' : '续写'}
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
        <Map className="mx-auto h-10 w-10 text-[hsl(var(--fg-muted))]" strokeWidth={1.5} aria-hidden />
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

/** 资料分区：作品设定摘要 + 章节大纲（可点击改写标题/要点，PATCH work.settings） */
export function AssetsPane({ work, nextIndex, onUpdated }: { work: Work; nextIndex: number; onUpdated: (w: Work) => void }) {
  const s = work.settings;
  const outlines = s.chapterOutlines ?? [];
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftPlot, setDraftPlot] = useState('');
  const [saving, setSaving] = useState(false);

  function startEdit(o: { index: number; title: string; plot: string }): void {
    setEditingIdx(o.index);
    setDraftTitle(o.title);
    setDraftPlot(o.plot);
  }

  /** 保存改写：settings 整体替换（乐观锁），失败提示重试 */
  async function saveOutline(index: number): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      const nextOutlines = outlines.map((o) =>
        o.index === index ? { ...o, title: draftTitle.trim() || o.title, plot: draftPlot } : o,
      );
      const latest = await apiFetch<Work>(`/api/works/${work.id}`);
      const updated = await updateWork(work.id, {
        revision: latest.revision,
        settings: { ...work.settings, chapterOutlines: nextOutlines },
      });
      onUpdated(updated);
      setEditingIdx(null);
    } catch {
      alert('大纲保存失败（可能版本冲突），请重试');
    } finally {
      setSaving(false);
    }
  }

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
        <p className="mb-2 text-[10px] text-[hsl(var(--fg-muted))]">点条目可改写标题与剧情要点（改写后按大纲写以此为准）</p>
        {outlines.length === 0 && (
          <p className="text-xs text-[hsl(var(--fg-muted))]">暂无章节大纲（可在桌面版一键导入或对话大纲生成）</p>
        )}
        <ol className="flex flex-col gap-1.5">
          {outlines.map((o) => {
            const active = o.index === nextIndex;
            if (editingIdx === o.index) {
              return (
                <li key={o.index} className="rounded-lg border border-[hsl(var(--accent))]/50 bg-[hsl(var(--accent))]/5 p-2.5" data-testid={`outline-edit-${o.index}`}>
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    aria-label={`第${o.index}章标题`}
                    className="mb-1.5 h-9 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-xs outline-none focus:border-[hsl(var(--accent))]"
                  />
                  <textarea
                    value={draftPlot}
                    onChange={(e) => setDraftPlot(e.target.value)}
                    rows={4}
                    aria-label={`第${o.index}章剧情要点`}
                    className="w-full resize-y rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] p-2 text-xs leading-5 outline-none focus:border-[hsl(var(--accent))]"
                  />
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void saveOutline(o.index)}
                      disabled={saving}
                      data-testid={`outline-save-${o.index}`}
                      className="h-8 flex-1 rounded-lg bg-[hsl(var(--accent))] text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
                    >
                      {saving ? '保存中…' : '保存'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingIdx(null)}
                      className="h-8 flex-1 rounded-lg border border-[hsl(var(--border-soft))] text-xs text-[hsl(var(--fg-muted))]"
                    >
                      取消
                    </button>
                  </div>
                </li>
              );
            }
            return (
              <li key={o.index}>
                <button
                  type="button"
                  onClick={() => startEdit(o)}
                  data-testid={`outline-item-${o.index}`}
                  className={`w-full rounded-lg px-3 py-2 text-left text-xs leading-5 ${
                    active ? 'border border-[hsl(var(--accent))]/50 bg-[hsl(var(--accent))]/10' : ''
                  }`}
                >
                  <span className={active ? 'font-medium text-[hsl(var(--accent))]' : 'font-medium'}>
                    {chapterTitle(o.index, o.title)}
                  </span>
                  {active && <span className="ml-1.5 text-[10px] text-[hsl(var(--accent))]">← 下一章</span>}
                  <p className="mt-0.5 text-[hsl(var(--fg-muted))]">{o.plot}</p>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

/** 💭 思考折叠块（DeepSeek 式）：流式中默认展开跟随思考，正文开始后自动收起为一行（重roll场景默认收起） */
function ThinkingInline({ text, done, startCollapsed = false }: { text: string; done: boolean; startCollapsed?: boolean }) {
  const [open, setOpen] = useState(!startCollapsed);
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
        <Brain className="h-3.5 w-3.5" aria-hidden />
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
