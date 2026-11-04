/**
 * 书内「全书策划对话」（反馈：毫无头绪也能聊大纲——每书独立会话，零章节即可开聊）。
 *
 * - 聊世界观/主角/势力/大纲 → 出策划案卡 → 「一键应用到资料」（写 settings + 建角色卡/世界书并绑定）
 * - 「🗂 历史」抽屉：每次应用的版本快照可回滚（改错了能找回之前的所有版本）
 * - 上下文持久化（localStorage 按 workId），离开页面再回来聊天记录不丢
 */
import { useMemo, useRef, useState } from 'react';
import { CircleHelp, History, Sparkles } from 'lucide-react';

import { generateTextOnce } from '../../../../api/llm';
import { useSettingsStore } from '../../../../stores/settings';
import type { Work } from '@shared/work';

import {
  bookPlannerMessages,
  bookPlannerSystem,
  loadChat,
  loadHistory,
  proposalToSlice,
  pushHistory,
  saveChat,
  type AppliedVersion,
  type BookTurn,
} from '../../../planner/book-planner';
import { parsePlannerReply, type PlannerProposal } from '../../../planner/planner-llm';
import PlannerQuestions from '../../../planner/PlannerQuestions';
import { applyProposalToBook, restoreBookSlice, type ApplyStage } from './book-outline-apply';

interface Props {
  work: Work;
  /** 应用/回滚成功回调（宿主同步 workStore，切「资料」即可见） */
  onApplied: (w: Work) => void;
}

const strip = (t: string): string => t.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

export default function BookOutlineChat({ work, onApplied }: Props) {
  const prefs = useSettingsStore((s) => s.llmPrefs);
  const initial = useMemo(() => loadChat(work.id), [work.id]);
  const [turns, setTurns] = useState<BookTurn[]>(initial.turns);
  const [proposal, setProposal] = useState<PlannerProposal | null>(initial.proposal);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [aiStage, setAiStage] = useState<ApplyStage | null>(null);
  const [appliedMsg, setAppliedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const history = useMemo(() => loadHistory(work.id), [work.id, appliedMsg]);
  const listRef = useRef<HTMLDivElement>(null);

  function scrollBottom(): void {
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
  }

  function commit(next: { turns: BookTurn[]; proposal: PlannerProposal | null }): void {
    saveChat(work.id, next);
    setTurns(next.turns);
    setProposal(next.proposal);
  }

  const system = bookPlannerSystem({
    title: work.title,
    genre: work.settings.subGenre || work.settings.genre,
    settingsBits: [
      work.settings.subGenre || work.settings.genre,
      work.settings.coreConflict ? `核心矛盾：${work.settings.coreConflict}` : '',
      work.settings.backgroundNote ? `背景：${work.settings.backgroundNote.slice(0, 80)}` : '',
    ].filter(Boolean).join('；'),
    chapterCount: 0,
    chapterTail: '',
  });

  async function send(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text || busy) return;
    setInput('');
    setError(null);
    const history = [...turns, { role: 'user' as const, text }];
    commit({ turns: history, proposal });
    setBusy(true);
    scrollBottom();
    try {
      const raw = await generateTextOnce(
        {
          source: prefs.source,
          model: prefs.model,
          messages: bookPlannerMessages(system, history, text, proposal),
          temperature: 0.8,
          maxTokens: 10000,
          thinking: prefs.thinking !== false,
        },
        24000,
      );
      const parsed = parsePlannerReply(strip(raw));
      if (!parsed) {
        commit({ turns: [...history, { role: 'assistant' as const, text: strip(raw) || '（空回复）' }], proposal });
      } else {
        const aiTurn: BookTurn = { role: 'assistant' as const, text: parsed.reply, questions: parsed.questions };
        commit({ turns: [...history, aiTurn], proposal: parsed.proposal ?? proposal });
      }
      scrollBottom();
    } catch (err) {
      commit({ turns: [...history, { role: 'assistant' as const, text: `⚠️ ${err instanceof Error ? err.message : '请求失败，请重试'}` }], proposal });
      scrollBottom();
    } finally {
      setBusy(false);
    }
  }

  /** 确认策划案 → 一键应用（数据层编排见 book-outline-apply） */
  async function apply(p: PlannerProposal): Promise<void> {
    if (applying) return;
    const ok = confirm(
      `将写入《${work.title}》的「资料」：${(p.extracted.chapters ?? []).length} 章大纲、背景、核心矛盾、势力，并按角色一键建卡绑定。\n` +
        '已有正文不受影响；本次应用前的资料自动存入历史，可随时回滚。继续？',
    );
    if (!ok) return;
    setApplying(true);
    setError(null);
    try {
      const { updated, msg } = await applyProposalToBook(work, p, setAiStage);
      onApplied(updated);
      setAppliedMsg(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : '应用失败，请重试');
    } finally {
      setAiStage(null);
      setApplying(false);
    }
  }

  /** 历史回滚：恢复该版本的资料切片（不动已绑定的卡/书） */
  async function rollback(v: AppliedVersion): Promise<void> {
    try {
      const updated = await restoreBookSlice(work, v);
      onApplied(updated);
      setAppliedMsg(`已回滚到 ${new Date(v.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 的版本`);
    } catch {
      setError('回滚失败（可能版本冲突），请重试');
    }
  }

  const stageText =
    aiStage === 'cards' ? '建角色卡…' : aiStage === 'worldbook' ? '建世界书…' : aiStage === 'settings' ? '写入资料…' : '应用中…';

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="book-outline-chat">
      {/* 状态条：说明 + 历史入口 */}
      <div className="shrink-0 px-4 pt-3">
        <p className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--fg-muted))]" data-testid="book-outline-hint">
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
          全书策划（每本书独立会话）——世界观 · 主角 · 势力 · 大纲，确认后一键写入「资料」
          <button
            type="button"
            onClick={() => setHistOpen((v) => !v)}
            data-testid="book-outline-hist-btn"
            className="ml-auto flex shrink-0 items-center gap-1 text-[hsl(var(--accent))]"
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            历史{history.length > 0 ? `(${history.length})` : ''}
          </button>
        </p>
        {histOpen && (
          <div className="mt-1.5 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-2" data-testid="book-outline-hist-panel">
            {history.length === 0 ? (
              <p className="px-1 text-[11px] text-[hsl(var(--fg-muted))]">还没有应用记录——确认策划案后这里会存档每个版本</p>
            ) : (
              history
                .slice()
                .reverse()
                .map((v) => (
                  <div key={v.at} className="flex items-center gap-2 px-1 py-1 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-[hsl(var(--fg-muted))]">
                      {new Date(v.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} ·{' '}
                      {v.slice.chapterOutlines.length} 章 · {v.proposal.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => void rollback(v)}
                      className="shrink-0 rounded-md border border-[hsl(var(--border-soft))] px-2 py-0.5 text-[hsl(var(--accent))]"
                    >
                      恢复
                    </button>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      {/* 聊天流 */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="m-pop flex flex-col gap-2">
          {turns.map((t, i) => (
            <div key={i} className={`${t.role === 'user' ? 'self-end' : 'self-start'} max-w-[88%]`}>
              {t.interrupted ? (
                <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" data-testid="book-outline-interrupted">
                  <p className="font-medium text-amber-700 dark:text-amber-400">📋 内容生成中断</p>
                  <p className="mt-1 text-[11px] text-[hsl(var(--fg-muted))]">发送「继续」从断点接着写。</p>
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[11px] text-[hsl(var(--fg-muted))]">查看原始内容</summary>
                    <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-[hsl(var(--bg))] p-2 text-[11px]">{t.text.slice(0, 3000)}</pre>
                  </details>
                </div>
              ) : (
                <div
                  className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs leading-5 ${
                    t.role === 'user' ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]' : 'bg-[hsl(var(--surface))]'
                  }`}
                >
                  {t.text}
                  {t.questions && t.questions.length > 0 && i === turns.length - 1 && !busy && (
                    <PlannerQuestions questions={t.questions} busy={busy} onSend={(txt) => void send(txt)} />
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && (
            <p className="self-start text-xs text-[hsl(var(--fg-muted))]">
              <CircleHelp className="mr-1 inline h-3.5 w-3.5 animate-pulse" aria-hidden />
              策划编辑思考中…
            </p>
          )}
          {error && <p className="rounded-lg bg-[hsl(var(--danger))]/10 p-2 text-xs text-[hsl(var(--danger))]">{error}</p>}
          {appliedMsg && (
            <p
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-600 dark:text-emerald-400"
              data-testid="book-outline-applied"
            >
              {appliedMsg}
            </p>
          )}
        </div>

        {/* 策划案卡：确认后一键应用到「资料」 */}
        {proposal && !busy && (
          <div className="mt-3 rounded-2xl border-2 border-[hsl(var(--accent))]/50 bg-[hsl(var(--surface))] p-3" data-testid="book-proposal-card">
            <p className="text-sm font-semibold">策划案：{proposal.title}</p>
            <p className="mt-0.5 text-[11px] text-[hsl(var(--fg-muted))]">
              题材：{proposal.genre} · 角色 {proposal.extracted.characters.length} · 势力 {proposal.extracted.factions.length} ·{' '}
              {(proposal.extracted.chapters ?? []).length} 章大纲
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-[hsl(var(--fg-muted))]">查看策划案全文</summary>
              <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[hsl(var(--bg))] p-2 text-[11px] leading-4">
                {JSON.stringify({ title: proposal.title, genre: proposal.genre, ...proposal.extracted }, null, 1).slice(0, 4000)}
              </pre>
            </details>
            <button
              type="button"
              onClick={() => void apply(proposal)}
              disabled={applying}
              data-testid="book-proposal-apply"
              className="mt-2 h-10 w-full rounded-xl bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
            >
              {applying ? stageText : '✅ 确认——一键生成到「资料」（含角色卡/世界书）'}
            </button>
          </div>
        )}
      </div>

      {/* 输入行 */}
      <div className="safe-bottom flex shrink-0 gap-2 border-t border-[hsl(var(--border-soft))] px-4 py-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void send(input)}
          placeholder="这本书的任何想法（毫无头绪就写个词，我帮你发散）"
          disabled={busy}
          data-testid="book-outline-input"
          className="h-10 min-w-0 flex-1 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void send(input)}
          disabled={busy || !input.trim()}
          data-testid="book-outline-send"
          className="h-10 shrink-0 rounded-xl bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
  );
}
