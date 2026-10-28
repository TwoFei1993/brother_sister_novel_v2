/**
 * 对话大纲·迭代聊天（P2.3，移动端大纲分区）：聊某章怎么改 → 确认 → 生成新版本
 *
 * - 关键词+按钮双通道（共识 D5）：AI 提示关键词时直接给【确认生成新版本】按钮（点击=发送关键词，同代码路径）
 * - 新版本 = 基于锁定章当前激活版本全文 + 对话累积要点重写，appendSwipe 追加（旧版本不动，自动命名 vN）
 * - 会话态内存级（MVP 不持久化聊天历史；生成的新版本落库为章节版本资产）
 */
import { useMemo, useRef, useState } from 'react';
import { Check, Target } from 'lucide-react';

import { apiFetch } from '../../../api/client';
import type { GenerateMessage } from '../../../api/llm';
import { buildGenerateBody, generateTextOnce } from '../../../api/llm';
import { useWorkStore } from '../../../stores/work';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';
import { useSettingsStore } from '../../../stores/settings';
import { patchMessage } from '../../../api/works';
import { appendSwipe } from '../../../hooks/generation-flow';
import {
  ITER_KEYWORD,
  buildIterChatMessages,
  buildRewriteMessages,
  extractRewriteText,
  hitsIterKeyword,
  parseIterReply,
  type IterChapterRef,
} from '../../planner/iter-llm';

interface ChatLine {
  role: 'user' | 'assistant';
  content: string;
}

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
  const [history, setHistory] = useState<ChatLine[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [lockedIndex, setLockedIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
    setHistory((h) => [...h, { role: 'assistant', content: `⏳ 正在按要点重写第${target.chapter!.index}章，生成后自动成为新版本…` }]);
    scrollBottom();
    const text = await callLlm(
      buildRewriteMessages({
        workTitle: work.title,
        chapter: {
          index: target.chapter!.index,
          title: target.chapter!.title,
          content: active?.content ?? '',
        },
        brief,
      }),
    );
    if (!text) {
      setHistory((h) => [...h, { role: 'assistant', content: '⚠️ 生成失败（模型无输出），请重试。' }]);
      scrollBottom();
      return;
    }
    const updated = appendSwipe(target, text, { generationMs: 0, model: prefs.model, tokenCount: 0 });
    useWorkStore.getState().upsertLocal(updated);
    try {
      await patchMessage(work.id, updated);
    } catch {
      console.warn('[OutlineIterChat] 新版本持久化失败');
    }
    onDone(updated);
    setHistory((h) => [
      ...h,
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
    setHistory((h) => [...h, { role: 'user', content: text }]);
    scrollBottom();

    // 关键词命中：锁定章 + 有要点 → 直接重写（关键词等价确认按钮，同代码路径）
    if (hitsIterKeyword(text) && locked) {
      const brief = history.filter((l) => l.role === 'assistant').at(-1)?.content ?? '按对话中的意见修改';
      setBusy(true);
      try {
        await rewriteLockedChapter(brief);
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const raw = await callLlm(buildIterChatMessages({ workTitle: work.title, chapters: chapterRefs, history, userText: text }));
      const parsed = parseIterReply(raw);
      const reply = parsed?.reply ?? raw; // 解析失败：原文当回复显示
      if (parsed?.chapterIndex != null) setLockedIndex(parsed.chapterIndex);
      setHistory((h) => [...h, { role: 'assistant', content: reply }]);
      scrollBottom();
    } catch {
      setHistory((h) => [...h, { role: 'assistant', content: '⚠️ 助手暂时联系不上（网络/模型错误），稍后再试。' }]);
      scrollBottom();
    } finally {
      setBusy(false);
    }
  }

  /** 确认按钮：AI 回复提示了关键词时显示（点击=发送关键词） */
  const showConfirm = !busy && locked != null && history.some((l) => l.role === 'assistant' && l.content.includes(ITER_KEYWORD));

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="outline-iter-chat">
      {/* 锁定章提示 */}
      <div className="shrink-0 px-4 pt-3">
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
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
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
