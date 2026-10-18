/**
 * 写作台页（/work/:id，设计 §7.1）：novel=B 沉浸阅读+指挥条；chat=占位（Task 23）
 *
 * - loadWork 拉作品+尾部 50 条；ReadingView 触底回调 loadOlder 向上分页（§4.6）
 * - 生成接线 useGenerate：续写/继续/换一支（重生成）完成后 upsertLocal 同步消息流
 * - 顶栏：返回书架 + 作品名 + 生成中停止；目录抽屉与设置抽屉开关
 * - 空态：续写引导 + 绑定卡 alternate_greetings 备选开场（可一键作为序章入库）
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { upsertMessage } from '../api/works';
import { loadAssembleAssets } from '../hooks/generation-pipeline';
import { useGenerate } from '../hooks/useGenerate';
import CommandBar from '../features/workbench/CommandBar';
import ChapterDrawer, { scrollToChapter } from '../features/workbench/ChapterDrawer';
import ReadingView from '../features/workbench/ReadingView';
import WorkSettingsSheet from '../features/workbench/WorkSettingsSheet';
import { useGenerationStore } from '../stores/generation';
import { useWorkStore } from '../stores/work';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

/** 空态引导：无章节且未在生成时展示；含备选开场（alternate_greetings）一键入库 */
function EmptyGuide({ work, onCreated }: { work: Work; onCreated: (m: Message) => void }) {
  const [greetings, setGreetings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let alive = true;
    loadAssembleAssets(work)
      .then((a) => {
        if (alive) setGreetings(a.cards[0]?.data.alternate_greetings ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [work]);

  async function importGreeting(text: string): Promise<void> {
    setImporting(true);
    const message: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      name: '小说家',
      content: text,
      createdAt: Date.now(),
      swipes: [text],
      swipeId: 0,
      chapter: { index: 1, title: '序章' },
      extra: {},
    };
    try {
      await upsertMessage(work.id, message);
      onCreated(message);
    } catch {
      console.warn('[WorkPage] 备选开场上传失败');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" data-testid="empty-guide">
      <p className="text-lg font-semibold">《{work.title}》</p>
      <p className="text-sm text-[hsl(var(--fg-muted))]">
        在下方输入剧情指令（可留空），点击「▶ 续写」开始创作第一章
      </p>
      {greetings.length > 0 && (
        <div className="mt-4 w-full max-w-md space-y-2">
          <p className="text-xs text-[hsl(var(--fg-muted))]">或使用角色卡备选开场：</p>
          {greetings.map((g, i) => (
            <button
              key={i}
              type="button"
              disabled={importing}
              onClick={() => importGreeting(g)}
              className="line-clamp-2 w-full rounded-lg border border-[hsl(var(--border-soft))] p-3 text-left text-xs transition-colors hover:border-[hsl(var(--accent))] disabled:opacity-40"
            >
              {g}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** chat 模式占位（Task 23 实现） */
function ChatPlaceholder(): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <p className="text-lg font-semibold">对话写作模式即将开放</p>
      <p className="text-sm text-[hsl(var(--fg-muted))]">酒馆式对话与多角色激活策略将在 Task 23 实现</p>
    </div>
  );
}

export default function WorkPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { work, messages, loading, loadError, hasMore, loadingOlder, loadWork, loadOlder, upsertLocal, setWork } =
    useWorkStore();
  const gen = useGenerate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (id) void loadWork(id);
    return () => useWorkStore.getState().reset();
  }, [id, loadWork]);

  const chapters = messages.filter(
    (m): m is Message & { chapter: NonNullable<Message['chapter']> } => m.chapter !== undefined,
  );
  const lastChapter = chapters.length > 0 ? chapters[chapters.length - 1] : null;
  const showReading = chapters.length > 0 || gen.streaming;

  async function handleGenerate(directive: string): Promise<void> {
    if (!work) return;
    const msg = await gen.generateChapter(work, messages, directive);
    if (msg) upsertLocal(msg);
  }

  async function handleContinue(): Promise<void> {
    if (!work) return;
    const partial = useGenerationStore.getState().buffer;
    const msg = await gen.continueFromPartial(work, messages, partial);
    if (msg) upsertLocal(msg);
  }

  /** 🎲换一支：多候选 ◀▶ 切换（PATCH）；仅一支时同指令重生成（追加候选） */
  async function handleToggleSwipe(delta: 1 | -1): Promise<void> {
    if (!work) return;
    if (lastChapter && lastChapter.swipes.length > 1) {
      const n = lastChapter.swipes.length;
      await useWorkStore.getState().updateSwipe(lastChapter.id, (lastChapter.swipeId + delta + n) % n);
      return;
    }
    if (lastChapter && !gen.streaming) {
      const msg = await gen.swipeRegenerate(work, messages, lastChapter);
      if (msg) upsertLocal(msg);
    }
  }

  const iconBtn =
    'flex h-10 min-w-10 items-center justify-center rounded-lg text-sm transition-colors hover:bg-[hsl(var(--surface))]';

  return (
    <div className="flex h-screen flex-col bg-[hsl(var(--bg))] text-[hsl(var(--fg))]">
      {/* 顶栏 */}
      <header className="safe-top flex items-center gap-1 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-2 py-1.5 sm:px-4">
        <button type="button" onClick={() => navigate('/')} className={iconBtn} title="返回书架" aria-label="返回书架">
          ←
        </button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
          {work?.title ?? '…'}
          {chapters.length > 0 && (
            <span className="ml-2 text-xs font-normal text-[hsl(var(--fg-muted))]">共 {chapters.length} 章</span>
          )}
        </h1>
        {gen.streaming && (
          <button
            type="button"
            onClick={gen.stop}
            data-testid="top-stop-btn"
            className={`${iconBtn} text-[hsl(var(--danger))]`}
            title="停止生成"
          >
            ⏹ 停止
          </button>
        )}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className={iconBtn}
          title="章节目录"
          aria-label="章节目录"
        >
          📖
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={iconBtn}
          title="作品设置"
          aria-label="作品设置"
        >
          ⚙
        </button>
      </header>

      {/* 错误条（生成失败人话提示；半成品保留可「继续」） */}
      {gen.error && (
        <div className="flex items-center gap-2 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--danger))]/10 px-4 py-2 text-xs text-[hsl(var(--danger))]">
          <span className="min-w-0 flex-1">{gen.error.message}</span>
          <button type="button" onClick={gen.clearError} className="shrink-0 underline">
            知道了
          </button>
        </div>
      )}

      {/* 主区 */}
      <main className="flex min-h-0 flex-1 flex-col">
        {loading && <p className="flex-1 py-24 text-center text-sm text-[hsl(var(--fg-muted))]">作品加载中…</p>}
        {loadError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <p className="text-sm text-[hsl(var(--fg-muted))]">作品加载失败（可能已被删除）</p>
            <button
              type="button"
              onClick={() => id && void loadWork(id)}
              className="h-10 rounded-lg border border-[hsl(var(--border-soft))] px-5 text-sm hover:border-[hsl(var(--accent))]"
            >
              重新加载
            </button>
          </div>
        )}
        {!loading && !loadError && work && work.mode === 'chat' && <ChatPlaceholder />}
        {!loading && !loadError && work && work.mode === 'novel' && (
          showReading ? (
            <ReadingView
              messages={messages}
              streaming={gen.streaming}
              buffer={gen.buffer}
              hasMore={hasMore}
              loadingOlder={loadingOlder}
              onNeedOlder={loadOlder}
            />
          ) : (
            <EmptyGuide work={work} onCreated={upsertLocal} />
          )
        )}
      </main>

      {/* 底部指挥条（仅 novel） */}
      {work && work.mode === 'novel' && !loadError && (
        <CommandBar
          streaming={gen.streaming}
          partialKept={gen.partialKept}
          canToggleSwipe={(lastChapter?.swipes.length ?? 0) > 1}
          swipePosition={lastChapter ? `${lastChapter.swipeId + 1}/${lastChapter.swipes.length}` : null}
          disabled={loading || loadError}
          busy={gen.streaming}
          onGenerate={handleGenerate}
          onToggleSwipe={handleToggleSwipe}
          onContinue={handleContinue}
          onStop={gen.stop}
        />
      )}

      {drawerOpen && (
        <ChapterDrawer
          open
          onClose={() => setDrawerOpen(false)}
          chapters={chapters.map((m) => ({ index: m.chapter.index, title: m.chapter.title }))}
          onLocate={scrollToChapter}
        />
      )}
      {settingsOpen && work && (
        <WorkSettingsSheet work={work} onClose={() => setSettingsOpen(false)} onSaved={setWork} />
      )}
    </div>
  );
}
