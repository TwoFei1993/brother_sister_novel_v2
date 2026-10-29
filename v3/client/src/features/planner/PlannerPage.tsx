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

import { buildGenerateBody, generateStream } from '../../api/llm';
import { createWork } from '../../api/works';
import { defaultNovelSettings } from '@shared/work';
import { useSettingsStore } from '../../stores/settings';
import { importAllAssets, type ImportedAssets } from '../misc/wizard/importAll';
import { parsePlannerReply, plannerMessages, proposalToChapterSettings, type PlannerProposal } from './planner-llm';
import { createSession, loadStore, persist, titleOf, type PlannerSession, type PlannerTurn } from './sessions';

import PlannerQuestions from './PlannerQuestions';
import PlannerSidebar from './PlannerSidebar';

const SIDEBAR_KEY = 'v3-planner-sidebar-open';

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
  const [busy, setBusy] = useState(false);
  /** 流式打字机：生成中的增量原文（💭前缀=思考流；null=未在流式） */
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 本轮流式请求的中止器（⏹ 停止 / 90s 无响应看门狗） */
  const abortRef = useRef<AbortController | null>(null);
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

  async function send(text: string, opts: { isReroll?: boolean } = {}): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);

    // 关键：本次消息必须进 LLM 历史（setSessions 是异步的，不能用旧值拼）
    const base = opts.isReroll ? turns.slice(0, -2) : turns;
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = base.map((t) => ({
      role: t.role,
      content: t.text,
    }));
    history.push({ role: 'user', content: trimmed });
    const userTurn: PlannerTurn = { role: 'user', text: trimmed };
    if (opts.isReroll) updateActive((s) => ensureTitle({ ...s, turns: [...s.turns.slice(0, -2), userTurn] }));
    else updateActive((s) => ensureTitle({ ...s, turns: [...s.turns, userTurn] }));
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    // 看门狗：90s 无任何帧（上游挂死）自动中止，避免「卡死」
    let lastActivity = Date.now();
    let timedOut = false;
    const touch = (): void => {
      lastActivity = Date.now();
    };
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastActivity > 90_000) {
        timedOut = true;
        ac.abort();
      }
    }, 5000);
    try {
      const msgs = plannerMessages(history, proposal);
      const prefs = useSettingsStore.getState().llmPrefs;
      // 流式打字机（推理模型思考久，无流式会像卡死）：思考流/正文增量实时显示
      let streaming = false;
      const callPlanner = (maxTokens: number): Promise<{ text: string; thinkingFull: string }> =>
        new Promise((resolve, reject) => {
          let full = '';
          let thinkingFull = '';
          void generateStream(
            buildGenerateBody({
              source: prefs.source,
              model: prefs.model,
              messages: msgs,
              temperature: opts.isReroll ? 0.9 : 0.8,
              maxTokens,
              thinking: prefs.thinking !== false,
              stream: true,
            }),
            {
              onChunk: (delta) => {
                touch();
                if (!streaming) {
                  streaming = true;
                  setStreamingText('');
                }
                full += delta;
                setStreamingText(full);
              },
              onThinking: (delta) => {
                touch();
                streaming = true;
                thinkingFull += delta;
                setStreamingText('💭' + thinkingFull.slice(-500)); // 思考流打字机（尾部 500 字）
              },
              onError: (e) => reject(new Error(e.message)),
              onDone: () => undefined,
            },
            ac.signal,
          )
            .then(() => resolve({ text: full, thinkingFull })) // think 剥离在 parsePlannerReply 内部处理
            .catch((err: unknown) => {
              reject(err instanceof Error && err.name === 'AbortError' ? new Error(timedOut ? '向导长时间无响应，已自动停止' : '已停止') : err);
            });
        });

      // 推理模型可能把预算吃在思考上（JSON 半截/空文本）→ 加倍预算重试一次（ed735c0 同模式）
      let result = await callPlanner(8000);
      let text = result.text;
      let parsed = parsePlannerReply(text);
      if (!parsed) {
        setStreamingText(null); // 清首轮打字机，重试重新流式
        result = await callPlanner(16000);
        text = result.text;
        parsed = parsePlannerReply(text);
      }
      if (!parsed) {
        // 无 JSON：当纯讨论展示（think 已在 parse 内剥离）
        updateActive((s) => ({ ...s, turns: [...s.turns, { role: 'assistant', text: text.trim() || '（空回复）' }] }));
        return;
      }
      // 思考显示兜底：流式 thinking 帧缺失的模型，从正文里提取 <think> 块为可折叠思考
      const thinkMatch = /<think>([\s\S]*?)<\/think>/i.exec(text);
      const thinkShown = result.thinkingFull || (thinkMatch ? thinkMatch[1].trim() : '');
      updateActive((s) => ({
        ...s,
        turns: [...s.turns, { role: 'assistant', text: parsed.reply, questions: parsed.questions, thinking: thinkShown || undefined }],
      }));
      if (parsed.proposal) {
        const proposalParsed = parsed.proposal;
        updateActive((s) => ({ ...s, proposal: proposalParsed }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败，请重试');
    } finally {
      window.clearInterval(watchdog);
      abortRef.current = null;
      setStreamingText(null);
      setBusy(false);
    }
  }

  /** ⏹ 手动停止本轮流式（不再等待上游） */
  function stopStreaming(): void {
    abortRef.current?.abort();
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
      {/* 顶栏（safe-top 适配 APK 状态栏） */}
      <header className="safe-top flex h-12 shrink-0 items-center gap-1 border-b border-[hsl(var(--border-soft))] px-3">
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
            {/* 空态引导（走查条目⑧）：新会话只有一条欢迎气泡时，给可点的示例想法，降低空白首屏的启动门槛 */}
            {turns.length <= 1 && !busy && (
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
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
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
                    i === turns.length - 1 && !busy ? (
                      <PlannerQuestions questions={t.questions} busy={busy} onSend={(text) => void send(text)} />
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
              </div>
            ))}

            {busy && streamingText && (
              <div className="flex justify-start">
                <div
                  className="max-w-[85%] whitespace-pre-wrap rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-4 py-2.5 text-sm leading-relaxed"
                  data-testid="planner-streaming"
                >
                  {streamingText.startsWith('💭') ? (
                    <span className="text-xs leading-5 text-[hsl(var(--fg-muted))]">{streamingText.slice(1)}▌</span>
                  ) : (
                    streamingText.slice(-800)
                  )}
                </div>
              </div>
            )}
            {busy && !streamingText && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-4 py-2.5 text-sm text-[hsl(var(--fg-muted))]">
                  <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--accent))]" />
                  向导思考中…
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
                    disabled={busy}
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
                  disabled={importing || busy}
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
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !busy) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                disabled={busy || importing}
                placeholder="描述你的创作想法，或对策划案提出修改意见…"
                aria-label="向导输入"
                data-testid="planner-input"
                className="max-h-32 min-h-[40px] min-w-0 flex-1 resize-none rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
              />
              {busy && (
                <button
                  type="button"
                  onClick={stopStreaming}
                  data-testid="planner-stop"
                  aria-label="停止生成"
                  className="h-10 shrink-0 rounded-lg border border-[hsl(var(--danger))]/40 px-3 text-sm text-[hsl(var(--danger))]"
                >
                  ⏹
                </button>
              )}
              <button
                type="button"
                onClick={() => void send(input)}
                disabled={busy || importing || !input.trim()}
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
