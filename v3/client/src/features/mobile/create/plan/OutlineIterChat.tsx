/**
 * 对话大纲·迭代聊天（P2.3，移动端大纲分区）：聊某章怎么改 → 确认 → 生成新版本
 *
 * - 预读取书籍资料（反馈②）：useBookBrief 复用 loadAssembleAssets（与正文生成同源：按章绑定生效、
 *   并行拉取）注入提示词；每本书的大纲对话都是独立会话且「读过这本书」；顶部展示已读取摘要
 * - 关键词+按钮双通道（共识 D5）：AI 提示关键词时直接给【确认生成新版本】按钮（点击=发送关键词，同代码路径）
 * - 新版本 = 基于锁定章当前激活版本全文 + 对话累积要点重写，appendSwipe 追加（旧版本不动，自动命名 vN）
 * - 会话持久化（反馈：切分区回来对话丢失）：history+lockedIndex 按 workId 存 localStorage，卸载/切换不丢
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenCheck, Check, Target } from 'lucide-react';

import type { GenerateMessage } from '../../../../api/llm';
import { generateTextOnce } from '../../../../api/llm';
import { submitTask, waitAndStore, taskPending, clearPending, consumeResult } from '../../../../lib/llmTask';
import { useWorkStore } from '../../../../stores/work';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';
import { useSettingsStore } from '../../../../stores/settings';
import { patchMessage } from '../../../../api/works';
import { appendSwipe } from '../../../../hooks/generation-flow';
import {
  ITER_KEYWORD,
  buildIterChatMessages,
  buildRewriteMessages,
  extractRewriteText,
  hitsIterKeyword,
  loadIterChat,
  parseIterReply,
  saveIterChat,
  type IterChapterRef,
  type IterChatLine,
} from '../../../planner/iter-llm';
import { useBookBrief } from './useBookBrief';

interface ChatLine extends IterChatLine {}

type ChapterMsg = Message & { chapter: NonNullable<Message['chapter']> };

export default function OutlineIterChat({
  work,
  chapters,
  onDone,
}: {
  work: Work;
  chapters: readonly { msg: ChapterMsg }[];
  /** 新版本生成成功回调（父级同步 store） */
  onDone: (msg: Message) => void;
}) {
  const prefs = useSettingsStore((s) => s.llmPrefs);
  /** 惰性初始化读 localStorage（仅一次）：切分区卸载后回来，对话与锁定章原样恢复 */
  const [stored] = useState(() => loadIterChat(work.id));
  const [history, setHistory] = useState<ChatLine[]>(stored.history);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [lockedIndex, setLockedIndex] = useState<number | null>(stored.lockedIndex);
  const listRef = useRef<HTMLDivElement>(null);
  const { brief: bookBrief, stat: briefStat, ok: briefOk } = useBookBrief(work);

  // 最新会话的 ref 镜像 + 卸载落盘：AI 回复到达时组件可能已卸载（用户发完消息就切分区），
  // 变更 useEffect 不再运行——卸载 cleanup 用 ref 兜底保存最后一轮（巡检修复）
  const latestRef = useRef({ history, lockedIndex });
  latestRef.current = { history, lockedIndex };
  useEffect(() => {
    const id = work.id;
    return () => saveIterChat(id, latestRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

  // 会话变化即落盘（挂载恢复 + 每次变更持久化）
  useEffect(() => {
    saveIterChat(work.id, { history, lockedIndex });
  }, [work.id, history, lockedIndex]);

  // 后台生成结果恢复（mount 一次）：大纲迭代回复追加进对话流；章节重写结果应用为新版本
  useEffect(() => {
    // outline-iter slot 的结果（waitAndStore 完成落盘）消费
    const iterResult = localStorage.getItem('v3-bg-result-outline-iter');
    if (iterResult) {
      localStorage.removeItem('v3-bg-result-outline-iter');
      localStorage.removeItem('v3-bg-task-outline-iter');
      const parsed = parseIterReply(iterResult);
      const reply = parsed?.reply ?? iterResult;
      setHistory((h) => [...h, { role: 'assistant', content: reply } as ChatLine]);
      if (parsed?.chapterIndex != null) setLockedIndex(parsed.chapterIndex);
    }
    // outline-rewrite slot 的结果应用（meta 持久化了 brief/model）
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (!k?.startsWith(`v3-outline-rewrite-apply-${work.id}-`)) continue;
      const chapterIdx = Number(k.slice(`v3-outline-rewrite-apply-${work.id}-`.length));
      const slot = `outline-rewrite-${work.id}-${chapterIdx}`;
      const resultText = localStorage.getItem(`v3-bg-result-${slot}`);
      if (!resultText) continue;
      localStorage.removeItem(`v3-bg-result-${slot}`);
      localStorage.removeItem(`v3-bg-task-${slot}`);
      applyRewrite(chapterIdx, resultText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

  const chapterRefs = useMemo<IterChapterRef[]>(
    () =>
      chapters.map(({ msg }) => ({
        index: msg.chapter!.index,
        title: msg.chapter!.title,
        excerpt: (msg.swipes[msg.swipeId]?.content ?? '').slice(0, 1200),
      })),
    [chapters],
  );
  const locked = chapters.find(({ msg }) => msg.chapter!.index === lockedIndex) ?? null;

  function scrollBottom(): void {
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
  }

  /** 追加对话轮并显式落盘（巡检修复）：卸载后 setHistory 是 no-op 且渲染期 ref 同步不再运行，
   *  只靠 useEffect/unmount cleanup 会丢最后一轮——以 ref 为唯一事实源，setState+落盘同步写 */
  function appendTurns(lines: ChatLine[]): ChatLine[] {
    const next = [...latestRef.current.history, ...lines];
    latestRef.current = { history: next, lockedIndex: latestRef.current.lockedIndex };
    setHistory(next);
    saveIterChat(work.id, latestRef.current);
    return next;
  }

  /** 更新锁定章并同步落盘（同 appendTurns 语义） */
  function setLocked(idx: number | null): void {
    latestRef.current = { history: latestRef.current.history, lockedIndex: idx };
    setLockedIndex(idx);
    saveIterChat(work.id, latestRef.current);
  }

  async function callLlm(messages: GenerateMessage[]): Promise<string> {
    // generateTextOnce：思考跟随用户设置 + 空输出自动加倍预算重试一次（推理模型思考吃满预算的通用兜底）
    return generateTextOnce(
      {
        source: prefs.source,
        model: prefs.model,
        messages,
        temperature: prefs.temperature,
        maxTokens: 16000,
        thinking: prefs.thinking !== false,
      },
      16000,
    ).then(extractRewriteText);
  }

  async function rewriteLockedChapter(brief: string): Promise<void> {
    if (!locked) return;
    const target = locked.msg;
    const active = target.swipes[target.swipeId];
    const slot = `outline-rewrite-${work.id}-${target.chapter!.index}`;
    appendTurns([{ role: 'assistant', content: `⏳ 已转后台重写第${target.chapter!.index}章——切出去干别的，回来自动成为新版本…` }]);
    scrollBottom();
    const prefs2 = useSettingsStore.getState().llmPrefs;
    await submitTask(slot, {
      source: prefs2.source,
      model: prefs2.model,
      messages: buildRewriteMessages({
        workTitle: work.title,
        chapter: {
          index: target.chapter!.index,
          title: target.chapter!.title,
          content: active?.content ?? '',
        },
        brief,
        bookBrief: briefOk ? bookBrief : undefined,
      }),
      thinking: prefs2.thinking !== false,
      params: { max_tokens: 16000, temperature: prefs2.temperature },
      label: `重写第${target.chapter!.index}章`,
    });
    // 后台完成后的应用（mount/visibility 恢复执行）：结果落 localStorage → 恢复消费
    localStorage.setItem(
      `v3-outline-rewrite-apply-${work.id}-${target.chapter!.index}`,
      JSON.stringify({ brief, model: prefs2.model }),
    );
    const text = await waitAndStore(slot).catch(async (err: Error) => {
      appendTurns([{ role: 'assistant', content: `⚠️ 重写失败：${err.message}，请重试。` }]);
      scrollBottom();
      return '';
    });
    if (!text) return;
    applyRewrite(target.chapter!.index, text);
    scrollBottom();
  }

  /** 后台重写结果的应用（mount/visibility 恢复共用）：appendSwipe 新版本 + 持久化 + onDone */
  function applyRewrite(chapterIdx: number, text: string): void {
    const target = chapters.find(({ msg }) => msg.chapter!.index === chapterIdx)?.msg;
    if (!target) return;
    const prefs2 = useSettingsStore.getState().llmPrefs;
    const updated = appendSwipe(target, text, { generationMs: 0, model: prefs2.model, tokenCount: 0 });
    useWorkStore.getState().upsertLocal(updated);
    try {
      void patchMessage(work.id, updated);
    } catch {
      console.warn('[OutlineIterChat] 新版本持久化失败');
    }
    onDone(updated);
    appendTurns([
      {
        role: 'assistant',
        content: `✅ 新版本已生成（${updated.swipes.at(-1)?.name}），可在「版本」分区查看切换；旧版本原样保留。`,
      },
    ]);
    scrollBottom();
  }

  async function send(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text || busy) return;
    setInput('');
    const history = appendTurns([{ role: 'user', content: text }]);
    scrollBottom();

    // 关键词命中：锁定章 + 有要点 → 直接重写（关键词等价确认按钮，同代码路径）
    if (hitsIterKeyword(text) && locked) {
      const brief = history.filter((l) => l.role === 'assistant').at(-1)?.content ?? '按对话中的意见修改';
      setBusy(true);
      try {
        await rewriteLockedChapter(brief);
      } catch (err) {
        // review #2：确认/重写主链路必须有错误兜底（generateTextOnce 空输出/4xx 抛错），不能 unhandled rejection
        appendTurns([{ role: 'assistant', content: `⚠️ 生成失败：${err instanceof Error ? err.message : '未知错误'}，请重试。` }]);
        scrollBottom();
      } finally {
        setBusy(false);
      }
      return;
    }

    // 大纲生成后台化（切出 App 继续生成——手机锁屏/切后台安全）：server 任务执行，回来消费
    const slot = 'outline-iter-' + work.id;
    setBusy(true);
    try {
      const messages = buildIterChatMessages({ workTitle: work.title, chapters: chapterRefs, history, userText: text, bookBrief: briefOk ? bookBrief : undefined });
      const prefs = useSettingsStore.getState().llmPrefs;
      await submitTask(slot, {
        source: prefs.source,
        model: prefs.model,
        messages,
        params: { max_tokens: 16000, temperature: prefs.temperature },
        thinking: prefs.thinking !== false,
        label: '大纲迭代',
      });
      appendTurns([{ role: 'assistant', content: '⏳ 已转后台生成——切出去干别的，回来自动继续。' }]);
      scrollBottom();
      const raw = await waitAndStore(slot);
      const parsed = parseIterReply(raw);
      const reply = parsed?.reply ?? raw; // 解析失败：原文当回复显示
      if (parsed?.chapterIndex != null) setLocked(parsed.chapterIndex);
      appendTurns([{ role: 'assistant', content: reply }]);
      scrollBottom();
    } catch {
      appendTurns([{ role: 'assistant', content: '⚠️ 助手暂时联系不上（网络/模型错误），稍后再试。' }]);
      scrollBottom();
    } finally {
      setBusy(false);
    }
  }

  /** 确认按钮：AI 回复提示了关键词时显示（点击=发送关键词） */
  const showConfirm = !busy && locked != null && history.some((l) => l.role === 'assistant' && l.content.includes(ITER_KEYWORD));

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="outline-iter-chat">
      {/* 锁定章提示 + 预读取摘要（反馈②：先读这本书的资料再聊） */}
      <div className="shrink-0 px-4 pt-3">
        <p className="mb-1 flex items-center gap-1.5 px-3 text-[11px] text-[hsl(var(--fg-muted))]" data-testid="iter-brief-stat">
          <BookOpenCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {briefStat}
        </p>
        {locked ? (
          <p className="rounded-lg bg-[hsl(var(--accent))]/10 px-3 py-1.5 text-xs text-[hsl(var(--accent))]" data-testid="iter-locked">
            <Target className="inline h-3.5 w-3.5 align-[-2px]" aria-hidden /> 目标章：第{locked.msg.chapter!.index}章 {locked.msg.chapter!.title || '未命名'}（点此更换）
            <button type="button" onClick={() => setLockedIndex(null)} className="ml-2 underline">
              取消
            </button>
          </p>
        ) : (
          <p className="px-3 text-xs text-[hsl(var(--fg-muted))]">和助手聊某一章想怎么改——它问清楚后会请你确认生成新版本（旧版本保留）</p>
        )}
        {!locked && chapterRefs.length > 0 && (
          <div className="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {chapterRefs.slice(-8).map((c) => (
              <button
                key={c.index}
                type="button"
                onClick={() => setLockedIndex(c.index)}
                className="h-7 shrink-0 rounded-full border border-[hsl(var(--border-soft))] px-3 text-xs text-[hsl(var(--fg-muted))]"
              >
                第{c.index}章
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 聊天流 */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {history.length === 0 && (
          <p className="py-8 text-center text-xs text-[hsl(var(--fg-muted))]">
            例：「第2章太平淡，结尾想要一个反转」→ 助手确认要点后，点下方按钮生成新版本
          </p>
        )}
        <div className="flex flex-col gap-2">
          {history.map((l, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-5 whitespace-pre-wrap ${
                l.role === 'user'
                  ? 'self-end bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]'
                  : 'self-start bg-[hsl(var(--surface))]'
              }`}
            >
              {l.content}
            </div>
          ))}
          {busy && <p className="self-start text-xs text-[hsl(var(--fg-muted))]">…思考中</p>}
        </div>
      </div>

      {/* 确认按钮 + 输入行 */}
      {showConfirm && (
        <button
          type="button"
          onClick={() => void send(ITER_KEYWORD)}
          data-testid="iter-confirm-btn"
          className="mx-4 mb-2 h-10 shrink-0 rounded-xl bg-amber-500/90 text-sm font-medium text-white"
        >
          确认生成新版本（= 发送「{ITER_KEYWORD.slice(0, 12)}…」）
        </button>
      )}
      <div className="safe-bottom flex shrink-0 gap-2 border-t border-[hsl(var(--border-soft))] px-4 py-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void send(input)}
          placeholder="这一章想怎么改？"
          disabled={busy}
          data-testid="iter-input"
          className="h-10 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void send(input)}
          disabled={busy || !input.trim()}
          data-testid="iter-send-btn"
          className="h-10 shrink-0 rounded-xl bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
  );
}
