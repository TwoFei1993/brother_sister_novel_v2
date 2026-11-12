/**
 * 聊天式创作向导（豆包式多会话）：左侧历史会话栏（可展开/收缩）+ 聊天流 + 策划案卡片
 *
 * 用户描述想法 → 向导 grill 式问清关键点 → 产出完整策划案 → 聊天迭代 → 一键开书。
 * 多会话：每个创作想法一个独立对话（localStorage 持久化，见 sessions.ts）；
 * 思考流打字机（💭+思考尾部滚动）；LLM 协议见 planner-llm.ts；导入复用 misc/wizard/importAllAssets。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, ClipboardList, Dices, Menu, Smartphone, WandSparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { createWork } from '../../api/works';
import { defaultNovelSettings } from '@shared/work';
import { useSettingsStore } from '../../stores/settings';
import { useBgLlmTask } from '../../hooks/useBgLlmTask';
import { importAllAssets, type ImportedAssets } from '../misc/wizard/importAll';
import { parsePlannerReply, plannerMessages, proposalToChapterSettings, type PlannerProposal } from './planner-llm';
import { createSession, loadStore, persist, titleOf, type PlannerSession, type PlannerTurn } from './sessions';

import PlannerQuestions from './PlannerQuestions';
import PlannerSidebar from './PlannerSidebar';

const SIDEBAR_KEY = 'v3-planner-sidebar-open';

/** 向导 bg 任务的提交上下文（持久化 localStorage——跨页面卸载/重挂恢复，ref 方案会丢结果） */
const PENDING_KEY = 'planner-pending-active';
interface PlannerPendingCtx {
  sessionId: string;
  messages: Array<{ role: string; content: string }>;
  retried: boolean;
  draft: string;
  fromInput: boolean;
}
function readPending(): PlannerPendingCtx | null {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as PlannerPendingCtx | null;
  } catch {
    return null;
  }
}
function clearPending(): void {
  localStorage.removeItem(PENDING_KEY);
}

export default function PlannerPage() {
  const navigate = useNavigate();
  const store0 = useMemo(loadStore, []);
  const [sessions, setSessions] = useState<PlannerSession[]>(store0.sessions);
  const [activeId, setActiveId] = useState(store0.activeId);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      // 窄屏（APK/手机）默认收起会话栏，聊天流全宽
      return localStorage.getItem(SIDEBAR_KEY) !== '0' && window.innerWidth >= 768;
    } catch {
      return window.innerWidth >= 768;
    }
  });
  const [input, setInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const turns = active?.turns ?? [];
  const proposal = active?.proposal ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, proposal]);

  /** 单一状态源：所有对话/策划案更新走 updateActive（顺带刷新 updatedAt 并落盘） */
  function updateActive(fn: (s: PlannerSession) => PlannerSession): void {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === activeId ? { ...fn(s), updatedAt: Date.now() } : s));
      persist({ sessions: next, activeId });
      return next;
    });
  }

  /** 按会话 id 写回（bg 任务的 onDone 可能在用户切走会话后触发——不能用绑定当前 activeId 的 updateActive） */
  function updateSessionById(sessionId: string, fn: (s: PlannerSession) => PlannerSession): void {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === sessionId ? { ...fn(s), updatedAt: Date.now() } : s));
      persist({ sessions: next, activeId });
      return next;
    });
  }

  /**
   * 向导生成后台化（用户报告 2026-11-11：切出 App 必死「长时间无响应，已自动停止」——
   * 页面内流式 SSE 切后台必断 + 90s 看门狗中止；bg 任务 server 端执行，切出安全）。
   * 提交上下文持久化 localStorage（跨页面卸载/重挂恢复——ref 方案会丢结果，同场景重写教训）。
   */
  const plannerBg = useBgLlmTask(
    'planner-global',
    (text) => {
      const ctx = readPending();
      clearPending();
      if (!ctx) return;
      void (async () => {
        let parsed = parsePlannerReply(text);
        // 推理模型把预算吃在思考上（JSON 半截）→ 翻倍预算重提交一次（原 callPlanner 双段语义）
        if (!parsed && !ctx.retried) {
          ctx.retried = true;
          localStorage.setItem(PENDING_KEY, JSON.stringify(ctx));
          plannerBg.submit({
            source: useSettingsStore.getState().llmPrefs.source,
            model: useSettingsStore.getState().llmPrefs.model,
            messages: ctx.messages as never,
            thinking: useSettingsStore.getState().llmPrefs.thinking !== false,
            params: { max_tokens: 24000 },
            label: '向导生成（预算翻倍重试）',
          });
          return;
        }
        if (!parsed) {
          updateSessionById(ctx.sessionId, (s) => ({ ...s, turns: [...s.turns, { role: 'assistant' as const, text: '生成失败：模型两轮均未返回合法结构——请重试或换个说法' }] }));
          if (ctx.fromInput) setInput(ctx.draft);
          return;
        }
        updateSessionById(ctx.sessionId, (s) => ({
          ...s,
          turns: [...s.turns, { role: 'assistant' as const, text: parsed!.reply, questions: parsed!.questions }],
        }));
        if (parsed!.proposal) {
          const proposalParsed = parsed!.proposal;
          updateSessionById(ctx.sessionId, (s) => ({ ...s, proposal: proposalParsed }));
        }
      })();
    },
    (msg: string) => {
      const ctx = readPending();
      clearPending();
      setError(msg || '请求失败，请重试');
      if (ctx?.fromInput) setInput(ctx.draft);
    },
  );
  const bgBusy = plannerBg.state?.status === 'submitting' || plannerBg.state?.status === 'running';

  function newSession(): void {
    const s = createSession();
    setSessions((prev) => {
      const next = [s, ...prev];
      persist({ sessions: next, activeId: s.id });
      return next;
    });
    setActiveId(s.id);
  }

  function removeSession(id: string): void {
    setSessions((prev) => {
      let next = prev.filter((s) => s.id !== id);
      if (next.length === 0) next = [createSession()];
      const aid = next.some((s) => s.id === activeId) ? activeId : next[0].id;
      persist({ sessions: next, activeId: aid });
      setActiveId(aid);
      return next;
    });
  }

  /** 会话标题：首条用户消息后自动生成（一次） */
  function ensureTitle(s: PlannerSession): PlannerSession {
    if (s.title !== '新对话') return s;
    return { ...s, title: titleOf(s.turns) };
  }

  /** 发送（后台化）：切出 App 生成继续；questionRounds≥3 或用户点「直接生成」→ 附加收敛指令强制出案 */
  async function send(
    text: string,
    opts: { isReroll?: boolean; fromInput?: boolean; forceGenerate?: boolean } = {},
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || bgBusy) return;
    setError(null);
    // 反馈⑤（review #5）：仅输入框发起的发送清空输入框——chip/问题提交/重roll 不经输入框，不动草稿
    if (opts.fromInput) setInput('');

    // 关键：本次消息必须进 LLM 历史（setSessions 是异步的，不能用旧值拼）
    const base = opts.isReroll ? turns.slice(0, -2) : turns;
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = base.map((t) => ({
      role: t.role,
      content: t.text,
    }));
    // 提问轮次硬限制（用户要求：最多 3 轮）：第 3 轮回答或用户点「直接生成」→ 附加收敛指令
    const questionRounds = turns.filter((t) => t.role === 'assistant' && (t.questions?.length ?? 0) > 0).length;
    const finalText =
      opts.forceGenerate || questionRounds >= 3
        ? `${trimmed}\n（请直接基于以上全部信息生成完整策划案：questions 传空数组、outline 一次性填全，不要再提问）`
        : trimmed;
    history.push({ role: 'user', content: finalText });
    const userTurn: PlannerTurn = { role: 'user', text: trimmed };
    if (opts.isReroll) updateActive((s) => ensureTitle({ ...s, turns: [...s.turns.slice(0, -2), userTurn] }));
    else updateActive((s) => ensureTitle({ ...s, turns: [...s.turns, userTurn] }));

    const msgs = plannerMessages(history, proposal);
    const prefs = useSettingsStore.getState().llmPrefs;
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        sessionId: activeId,
        messages: msgs,
        retried: false,
        draft: trimmed,
        fromInput: opts.fromInput ?? false,
      } satisfies PlannerPendingCtx),
    );
    plannerBg.submit({
      source: prefs.source,
      model: prefs.model,
      messages: msgs as never,
      thinking: prefs.thinking !== false,
      params: { max_tokens: 32000, temperature: opts.isReroll ? 0.9 : 0.8 },
      label: '向导生成',
    });
  }

  async function confirmImport(): Promise<void> {
    if (!proposal) return;
    setImporting(true);
    setError(null);
    try {
      const assets: ImportedAssets = await importAllAssets(proposal.extracted);
      const { chapterOutlines, desiredChapterCount } = proposalToChapterSettings(proposal);
      const work = await createWork({
        title: proposal.title,
        mode: 'novel',
        genre: proposal.genre,
        characterIds: assets.characterIds,
        worldbookIds: assets.worldbookIds,
        settings: {
          ...defaultNovelSettings,
          chapterOutlines,
          desiredChapterCount,
          backgroundNote: proposal.extracted.background,
          coreConflict: proposal.extracted.conflict,
          factions: proposal.extracted.factions.join('、'),
        },
      });
      navigate(`/work/${work.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败，请重试');
      setImporting(false);
    }
  }

  const p = proposal;

  return (
    <div className="flex h-[100dvh] flex-col bg-[hsl(var(--bg))] text-[hsl(var(--fg))]">
      {/* 顶栏（safe-top 适配 APK 状态栏；不透明底——滚动内容不再从标题后透出） */}
      <header className="safe-top flex h-12 shrink-0 items-center gap-1 border-b border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          data-testid="sidebar-toggle"
          aria-label={sidebarOpen ? '收起会话栏' : '展开会话栏'}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-sm text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--surface))]"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <div className="flex items-center gap-2">
          <WandSparkles className="h-5 w-5" aria-hidden />
          <h1 className="text-base font-semibold">AI 创作向导</h1>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {/* 窄屏只留一个返回；桌面保留双入口 */}
          <button
            type="button"
            onClick={() => navigate('/m/create')}
            className="rounded px-2 py-1 text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))] md:hidden"
          >
            ← 返回
          </button>
          <button
            type="button"
            onClick={() => navigate('/m/create')}
            className="hidden rounded px-2 py-1 text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))] md:block"
          >
            <Smartphone className="h-4 w-4" aria-hidden />
            移动端
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="hidden rounded px-2 py-1 text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))] md:block"
          >
            返回书架
          </button>
        </div>
      </header>

      {/* 中段：侧栏 + 聊天列 */}
      <div className="relative flex min-h-0 flex-1">
        {/* 窄屏侧栏遮罩（点空白关闭） */}
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
            data-testid="planner-sidebar-mask"
          />
        )}
        {/* 侧栏：桌面常驻可收缩；窄屏浮层 */}
        {sidebarOpen && (
          <aside
            className="max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-xl"
            data-testid="planner-sidebar-wrap"
          >
            <PlannerSidebar
              sessions={sessions}
              activeId={active.id}
              onSelect={(sid) => {
                setActiveId(sid);
                if (window.innerWidth < 768) setSidebarOpen(false);
              }}
              onCreate={newSession}
              onDelete={removeSession}
              onClose={() => setSidebarOpen(false)}
            />
          </aside>
        )}

        {/* 右列：聊天流 + 输入区 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto px-3 pb-12 pt-4 md:px-4 md:py-6">
            {turns.map((t, i) => (
              <div key={i} className={`m-pop ${t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}>
                {t.interrupted ? (
                  <div
                    className="w-full rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
                    data-testid="planner-interrupted"
                  >
                    <p className="font-medium text-amber-700 dark:text-amber-400">📋 大纲内容生成中断（流式断开/输出过长）</p>
                    <p className="mt-1 text-xs leading-5 text-[hsl(var(--fg-muted))]">
                      已生成的部分保留在下方（点开查看原始内容）。点输入框发送「继续」，我会从断点接着写。
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-[hsl(var(--fg-muted))]">查看已生成的原始内容</summary>
                      <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-[hsl(var(--bg))] p-2 text-[11px] leading-4 text-[hsl(var(--fg-muted))]">
                        {t.text.slice(0, 4000)}
                      </pre>
                    </details>
                  </div>
                ) : (
                <div
                  data-testid={`planner-turn-${t.role}`}
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    t.role === 'user'
                      ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]'
                      : 'border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]'
                  }`}
                >
                  {t.text}
                  {/* 问题交互：仅最后一条 assistant 消息可多选合并提交，历史消息只读展示 */}
                  {t.questions && t.questions.length > 0 && (
                    i === turns.length - 1 && !bgBusy ? (
                      <PlannerQuestions questions={t.questions} busy={bgBusy} onSend={(text) => void send(text)} onGenerateDirect={() => void send("(跳过剩余提问，直接生成完整策划案)", { forceGenerate: true })} />
                    ) : (
                      <ul className="mt-2 space-y-2 border-t border-[hsl(var(--border-soft))] pt-2 text-xs" data-testid="planner-questions">
                        {t.questions.map((item, qi) => (
                          <li key={qi}>
                            <p className="mb-1 flex items-center gap-1.5"><CircleHelp className="h-4 w-4 shrink-0" aria-hidden />{item.q}</p>
                            {item.options.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {item.options.map((opt) => (
                                  <span
                                    key={opt}
                                    className="rounded-full border border-[hsl(var(--border-soft))] px-2.5 py-1 text-[hsl(var(--fg-muted))]"
                                  >
                                    {opt}
                                  </span>
                                ))}

                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                </div>
                )}
              </div>
            ))}

            {/* 空态引导（走查条目⑧）：新会话只有一条欢迎气泡时，给可点的示例想法，降低空白首屏的启动门槛 */}
            {turns.length <= 1 && !bgBusy && (
              <div className="flex flex-col items-center gap-3 pt-8 text-center" data-testid="planner-empty-guide">
                <p className="text-sm text-[hsl(var(--fg-muted))]">试一个开头（点击直接发送）：</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {[
                    '写一本末世题材的兄妹互动小说，妹妹有净化异能',
                    '星际题材，哥哥是飞船工程师，妹妹是AI人格',
                    '都市日常向，兄妹合开一家深夜便利店',
                  ].map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      onClick={() => void send(idea)}
                      data-testid="planner-idea-chip"
                      className="rounded-full border border-[hsl(var(--border-soft))] px-3.5 py-2 text-xs text-[hsl(var(--fg))] transition-colors hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))]"
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {bgBusy && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-4 py-2.5 text-sm text-[hsl(var(--fg-muted))]">
                  <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--accent))]" />
                  向导生成中…（已等 {plannerBg.state?.elapsedSec ?? 0}s）——可切出 App，回来自动回填
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-[hsl(var(--danger))]/10 p-2 text-sm text-[hsl(var(--danger))]" data-testid="planner-error">
                {error}
              </p>
            )}

            {/* 策划案卡片 */}
            {p && (
              <div className="rounded-2xl border-2 border-[hsl(var(--accent))]/50 bg-[hsl(var(--surface))] p-4" data-testid="proposal-card">
                <div className="mb-3 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-base font-semibold"><ClipboardList className="h-4 w-4 shrink-0" aria-hidden />策划案：{p.title}</p>
                  <button
                    type="button"
                    disabled={bgBusy}
                    onClick={() => {
                      const lastUser = [...turns].reverse().find((t) => t.role === 'user');
                      if (lastUser) void send(lastUser.text, { isReroll: true });
                    }}
                    data-testid="proposal-reroll"
                    title="同要求换一版策划案"
                    className="rounded-lg border border-[hsl(var(--border-soft))] px-2.5 py-1 text-xs hover:border-[hsl(var(--accent))] disabled:opacity-40"
                  >
                    <Dices className="h-4 w-4" aria-hidden />
                    换一版
                  </button>
                </div>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-[hsl(var(--fg-muted))]">题材</dt>
                    <dd>{p.genre}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[hsl(var(--fg-muted))]">人物</dt>
                    <dd>
                      <ul className="space-y-1">
                        {p.extracted.characters.map((c) => (
                          <li key={c.name + c.role}>
                            <span className="font-medium">{c.name}</span>（{c.role}）
                            {c.traits.length > 0 && <span className="text-[hsl(var(--fg-muted))]"> · {c.traits.join(' / ')}</span>}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[hsl(var(--fg-muted))]">背景</dt>
                    <dd className="whitespace-pre-wrap">{p.extracted.background}</dd>
                  </div>
                  {p.extracted.conflict && (
                    <div>
                      <dt className="text-xs text-[hsl(var(--fg-muted))]">核心矛盾</dt>
                      <dd>{p.extracted.conflict}</dd>
                    </div>
                  )}
                  {(p.extracted.chapters?.length ?? 0) > 0 && (
                    <div>
                      <dt className="text-xs text-[hsl(var(--fg-muted))]">章节大纲（{p.extracted.chapters?.length} 章）</dt>
                      <dd>
                        <ol className="list-decimal space-y-1 pl-4">
                          {p.extracted.chapters?.map((c) => (
                            <li key={c.index}>
                              <span className="font-medium">{c.title}</span>
                              <span className="block text-xs text-[hsl(var(--fg-muted))]">{c.plot}</span>
                            </li>
                          ))}
                        </ol>
                      </dd>
                    </div>
                  )}
                </dl>
                <button
                  type="button"
                  disabled={importing || bgBusy}
                  onClick={() => void confirmImport()}
                  data-testid="proposal-import"
                  className="mt-4 min-h-[40px] w-full rounded-lg bg-[hsl(var(--accent))] text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
                >
                  {importing ? '导入中…（建卡/世界书/作品）' : '没问题，一键开书（导入人物/世界观/大纲）'}
                </button>
              </div>
            )}
            <div ref={bottomRef} />
          </main>

          {/* 输入区（safe-bottom 适配 APK 导航条） */}
          <div className="safe-bottom shrink-0 border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-3 pb-3 pt-2 md:px-4 md:py-3">
            <div className="mx-auto flex max-w-3xl items-center gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !bgBusy) {
                    e.preventDefault();
                    void send(input, { fromInput: true });
                  }
                }}
                rows={1}
                disabled={bgBusy || importing}
                placeholder="描述你的创作想法…"
                aria-label="向导输入"
                data-testid="planner-input"
                className="max-h-32 min-h-[40px] min-w-0 flex-1 resize-none rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
              />
              {bgBusy && (
                <span className="shrink-0 px-2 text-[11px] text-[hsl(var(--fg-muted))]" data-testid="planner-bg-hint">
                  后台生成中
                </span>
              )}
              <button
                type="button"
                onClick={() => void send(input, { fromInput: true })}
                disabled={bgBusy || importing || !input.trim()}
                data-testid="planner-send"
                className="h-10 shrink-0 rounded-lg bg-[hsl(var(--accent))] px-4 text-sm font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
              >
                发送
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
