/**
 * 书内「全书策划对话」（反馈：毫无头绪也能聊大纲——每书独立会话，零章节即可开聊）。
 *
 * - 聊世界观/主角/势力/大纲 → 出策划案卡 → 「一键应用到资料」（写 settings + 建角色卡/世界书并绑定）
 * - 「🗂 历史」抽屉：每次应用的版本快照可回滚（改错了能找回之前的所有版本）
 * - 上下文持久化（localStorage 按 workId），离开页面再回来聊天记录不丢
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, History, MessageSquarePlus, Sparkles, Wand2 } from 'lucide-react';

import { submitTask, waitAndStore, taskPending, peekResult, consumeResult } from '../../../../lib/llmTask';
import { useSettingsStore } from '../../../../stores/settings';
import type { Work } from '@shared/work';

import {
  archiveChat,
  bookPlannerMessages,
  bookPlannerSystem,
  listArchived,
  loadChat,
  loadHistory,
  proposalToSlice,
  pushHistory,
  saveChat,
  takeArchived,
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
  const [archived, setArchived] = useState(() => listArchived(work.id));
  const history = useMemo(() => loadHistory(work.id), [work.id, appliedMsg]);
  const listRef = useRef<HTMLDivElement>(null);

  // —— 后台任务（切出 App 继续生成）：策划对话在 server 执行，回来消费结果 ——
  const slot = `book-outline-${work.id}`;
  /** 最新会话镜像（异步回调防闭包旧值） */
  const latestRef = useRef({ turns, proposal });
  latestRef.current = { turns, proposal };
  /** 本轮回复是否待应用（防多轮询链解冻后重复消费同一条回复） */
  const applyGuardRef = useRef(false);
  /** 等待中的用户输入（失败回滚重填草稿） */
  const lastSentRef = useRef('');

  /** 应用 AI 回复（防重入；由轮询链/恢复路径调用） */
  function applyReplyOnce(raw: string): void {
    if (!applyGuardRef.current) return;
    applyGuardRef.current = false;
    const prev = latestRef.current;
    const parsed = parsePlannerReply(strip(raw));
    if (!parsed) {
      commit({ turns: [...prev.turns, { role: 'assistant' as const, text: strip(raw) || '（空回复）' }], proposal: prev.proposal });
    } else {
      const aiTurn: BookTurn = { role: 'assistant' as const, text: parsed.reply, questions: parsed.questions };
      commit({ turns: [...prev.turns, aiTurn], proposal: parsed.proposal ?? prev.proposal });
    }
    scrollBottom();
  }

  /** 轮询链（页面冻结断点安全：server 任务继续跑，切回时 resume 重启） */
  function resumeOutlineTask(): void {
    if (!taskPending(slot)) return;
    setBusy(true);
    void waitAndStore(slot)
      .then((raw) => applyReplyOnce(raw))
      .catch((err) => {
        setError(err instanceof Error ? err.message : '请求失败，请重试');
        // 失败回滚（巡检语义）：撤掉等待中的用户轮，草稿还原
        const prev = latestRef.current;
        commit({ turns: prev.turns.slice(0, -1), proposal: prev.proposal });
        setInput(lastSentRef.current);
        scrollBottom();
      })
      .finally(() => setBusy(false));
  }

  // mount / 切回可见：消费已完成结果（上次切出期间完成的）+ 续跑 pending 轮询
  useEffect(() => {
    const done = consumeResult(slot);
    if (done !== null) {
      applyGuardRef.current = true; // 首次恢复强制应用（guard 初始 false 会拦）
      applyReplyOnce(done);
    } else {
      applyGuardRef.current = peekResult(slot) !== null || taskPending(slot);
    }
    resumeOutlineTask();
    const onVis = (): void => {
      if (document.visibilityState !== 'visible') return;
      const d = consumeResult(slot);
      if (d !== null) applyReplyOnce(d);
      else resumeOutlineTask();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.id]);

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
    scrollBottom();
    // 提交后台任务（切出 App 生成继续）：server 执行 + 轮询，锁屏/切后台安全
    try {
      await submitTask(slot, {
        source: prefs.source,
        model: prefs.model,
        messages: bookPlannerMessages(system, history, text, proposal),
        params: {
          max_tokens: prefs.thinking !== false ? 32000 : 16000,
          temperature: 0.8,
        },
        thinking: prefs.thinking !== false,
        label: '书籍策划',
      });
    } catch (err) {
      // 提交失败回滚（巡检语义）：恢复到发送前状态 + 草稿还原 + 临时错误条
      commit({ turns, proposal });
      setInput(text);
      setError(err instanceof Error ? err.message : '请求失败，请重试');
      scrollBottom();
      return;
    }
    applyGuardRef.current = true;
    lastSentRef.current = text;
    resumeOutlineTask();
  }

  /** 🆕 新对话：当前会话有实质内容则先存档（可恢复），再开空白会话（策划案一并清空） */
  function startNewChat(): void {
    if (busy) return;
    if (!confirm('开一个新对话？当前对话会存档，可在「历史」里随时恢复。')) return;
    const archived = archiveChat(work.id, { turns, proposal });
    setArchived(archived);
    const fresh = loadChat(work.id); // 空存储时返回默认欢迎会话
    saveChat(work.id, { turns: fresh.turns, proposal: null });
    setTurns(fresh.turns);
    setProposal(null);
    setError(null);
    setHistOpen(false);
  }

  /** 恢复存档会话：当前会话若有效先自动存档，再切换到所选存档 */
  function restoreFromArchive(index: number): void {
    const picked = takeArchived(work.id, index);
    if (!picked) return;
    archiveChat(work.id, { turns, proposal }); // 当前会话有效则顺手存档
    saveChat(work.id, picked);
    setTurns(picked.turns);
    setProposal(picked.proposal);
    setError(null);
    setHistOpen(false);
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
      {/* 状态条：说明 + 新对话 + 历史入口 */}
      <div className="shrink-0 px-4 pt-3">
        <p className="flex items-center gap-1.5 text-[11px] text-[hsl(var(--fg-muted))]" data-testid="book-outline-hint">
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
          全书策划（每本书独立会话）——确认后一键写入「资料」
          <button
            type="button"
            onClick={startNewChat}
            data-testid="book-outline-new-chat"
            title="开一个新对话（当前对话存档，可随时恢复）"
            className="ml-auto flex shrink-0 items-center gap-1 text-[hsl(var(--accent))]"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
            新对话
          </button>
          <button
            type="button"
            onClick={() => setHistOpen((v) => !v)}
            data-testid="book-outline-hist-btn"
            className="flex shrink-0 items-center gap-1 text-[hsl(var(--accent))]"
          >
            <History className="h-3.5 w-3.5" aria-hidden />
            历史{history.length > 0 ? `(${history.length})` : ''}
          </button>
        </p>
        {histOpen && (
          <div className="mt-1.5 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-2" data-testid="book-outline-hist-panel">
            {/* 会话存档区（🆕 新对话的旧会话，可切换恢复） */}
            <p className="px-1 text-[11px] font-medium text-[hsl(var(--fg))]">会话存档</p>
            {archived.length === 0 ? (
              <p className="px-1 pb-1 text-[11px] text-[hsl(var(--fg-muted))]">暂无——点「新对话」后旧对话自动存到这里</p>
            ) : (
              archived
                .map((a, i) => (
                  <div key={i} className="flex items-center gap-2 px-1 py-1 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-[hsl(var(--fg-muted))]">
                      {a.turns.filter((t) => t.role === 'user').length} 轮对话
                      {a.proposal ? ` · 有策划案《${a.proposal.title}》` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => restoreFromArchive(i)}
                      data-testid={`arch-restore-${i}`}
                      className="shrink-0 rounded-md border border-[hsl(var(--border-soft))] px-2 py-0.5 text-[hsl(var(--accent))]"
                    >
                      切换到此对话
                    </button>
                  </div>
                ))
                .reverse()
            )}
            {/* 应用记录区（策划案版本快照，可回滚资料） */}
            <p className="mt-1.5 px-1 text-[11px] font-medium text-[hsl(var(--fg))]">应用记录（资料版本）</p>
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

      {/* 🎯 直接生成（跳过一切提问，AI 替你拍板所有未定项直接出完整策划案） */}
      {!busy && (
        <div className="shrink-0 px-4 pb-1">
          <button
            type="button"
            onClick={() => void send('【直接生成】跳过提问，基于我已表达的想法直接拍板所有未定项，输出完整策划案。')}
            data-testid="book-outline-fast"
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-[hsl(var(--accent))]/40 bg-[hsl(var(--accent))]/5 text-xs text-[hsl(var(--accent))]"
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden />
            直接生成策划案（不想被提问，AI 替你决定一切）
          </button>
        </div>
      )}

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
