/**
 * 正文分区：章节选择 + 激活版本正文（就地编辑写回，PATCH 失败回滚）+ 手写/润色/重roll +
 * 指令生成下一章 + 批量连写。流式块与待绑定卡独立成件，编排数据全部来自 MobileWork。
 */
import { useEffect, useState } from 'react';
import { BookOpen, Dices, SquarePen, Zap } from 'lucide-react';

import { apiFetch } from '../../../../api/client';
import { generateTextOnce } from '../../../../api/llm';
import { patchMessage, upsertMessage } from '../../../../api/works';
import { useWorkStore } from '../../../../stores/work';
import { useSettingsStore } from '../../../../stores/settings';
import { appendSwipe, buildChapterMessage } from '../../../../hooks/generation-flow';
import { chapterTitle } from '../../../../lib/chapter-title';
import type { DetectedAsset, Message } from '@shared/message';
import type { Work } from '@shared/work';

import { ChapterChips } from './ChapterChips';
import { PendingAssetsCard } from './PendingAssetsCard';
import { ThinkingInline } from './ThinkingInline';
import { confirmPendingAsset } from './pending-assets';
import MobileTtsBar from '../voice/MobileTtsBar';
import type { ChapterMsg, Gen } from './types';

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

  async function rerollCurrent(): Promise<void> {
    if (!current || gen.streaming) return;
    setRerollTarget(current);
    const msg = await gen.swipeRegenerate(work, useWorkStore.getState().messages, current);
    setRerollTarget(null);
    onDone(msg);
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

      {/* 激活版本正文（标题独占一行；操作按钮等宽一行不折行） */}
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
      <PendingAssetsCard
        list={pendingList}
        sharedImport={sharedImport}
        onSharedImport={setSharedImport}
        onConfirm={(d) => void confirmAsset(d)}
        onDismiss={(d) => setPendingList((l) => l.filter((x) => x !== d))}
      />

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
