/**
 * 聊天式创作向导（对比豆包/ Sachs 类对话创作）：
 * 用户描述想法 → 向导产出结构化策划案（人物/世界观/章节大纲）+ 讨论语 → 聊天迭代（支持重roll）
 * → 确认导入：建角色卡 + 世界书 → 创建作品（携带章节大纲与资产绑定）→ 跳转写作台。
 * LLM 协议见 planner-llm.ts；导入复用 misc/wizard/importAllAssets。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiFetch } from '../../api/client';
import { buildGenerateBody, generateStream } from '../../api/llm';
import { createWork } from '../../api/works';
import { defaultNovelSettings } from '@shared/work';
import { useSettingsStore } from '../../stores/settings';
import { importAllAssets, type ImportedAssets } from '../misc/wizard/importAll';
import {
  parsePlannerReply,
  plannerMessages,
  proposalToChapterSettings,
  type PlannerProposal,
} from './planner-llm';

const SESSION_KEY = 'v3-planner-session-v1';
const WELCOME = '描述你的创作想法吧——题材、主角、核心冲突，一两句话就够。我会先问你几个关键问题，聊清楚了再出完整策划案。';

interface Turn {
  role: 'user' | 'assistant';
  /** user=用户输入；assistant=模型 reply 文本 */
  text: string;
  /** 助手消息附带的反问列表 */
  questions?: string[];
  /** 该轮是否生成失败（可重试） */
  failed?: boolean;
}

/** 恢复持久会话（localStorage；坏数据回退欢迎语） */
function loadSession(): { turns: Turn[]; proposal: PlannerProposal | null } {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const d = JSON.parse(raw) as { turns?: Turn[]; proposal?: PlannerProposal | null };
      if (Array.isArray(d.turns) && d.turns.length > 0) {
        return { turns: d.turns, proposal: d.proposal ?? null };
      }
    }
  } catch {
    /* 存储坏 → 欢迎语 */
  }
  return { turns: [{ role: 'assistant', text: WELCOME }], proposal: null };
}

export default function PlannerPage() {
  const navigate = useNavigate();
  const initial = useMemo(loadSession, []);
  const [turns, setTurns] = useState<Turn[]>(initial.turns);
  const [proposal, setProposal] = useState<PlannerProposal | null>(initial.proposal);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  /** 流式打字机：生成中的增量原文（null=未在流式） */
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, proposal]);

  // 持久会话：对话与策划案落 localStorage，刷新/重进不丢
  useEffect(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ turns, proposal }));
    } catch {
      /* 隐私模式静默 */
    }
  }, [turns, proposal]);

  function resetSession(): void {
    if (!window.confirm('清空对话与策划案，重新开始？')) return;
    setTurns([{ role: 'assistant', text: WELCOME }]);
    setProposal(null);
  }

  async function send(text: string, opts: { isReroll?: boolean } = {}): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);

    // 关键：本次消息必须进 LLM 历史（setTurns 是异步的，不能用 turns 旧值拼）
    const base = opts.isReroll ? turns.slice(0, -2) : turns;
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = base.map((t) => ({
      role: t.role,
      content: t.text,
    }));
    history.push({ role: 'user', content: trimmed });
    if (opts.isReroll) setTurns((prev) => [...prev.slice(0, -2), { role: 'user', text: trimmed }]);
    else setTurns((prev) => [...prev, { role: 'user', text: trimmed }]);
    setBusy(true);
    try {
      const msgs = plannerMessages(history, proposal);
      const prefs = useSettingsStore.getState().llmPrefs;
      // 流式打字机（推理模型思考久，无流式会像卡死）：增量文本实时显示；思考帧进「思考中」态
      let streaming = false;
      const callPlanner = (maxTokens: number): Promise<string> =>
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
                if (!streaming) {
                  streaming = true;
                  setStreamingText('');
                }
                full += delta;
                setStreamingText(full);
              },
              onThinking: (delta) => {
                streaming = true;
                thinkingFull += delta;
                setStreamingText('💭' + thinkingFull.slice(-500)); // 思考流打字机（尾部 500 字）
              },
              onError: (e) => reject(new Error(e.message)),
              onDone: () => undefined,
            },
          )
            .then(() => resolve(full)) // think 剥离在 parsePlannerReply 内部处理
            .catch(reject);
        });

      // 推理模型可能把预算吃在思考上（JSON 半截/空文本）→ 加倍预算重试一次（ed735c0 同模式）
      let text = await callPlanner(8000);
      let parsed = parsePlannerReply(text);
      if (!parsed) {
        setStreamingText(null); // 清首轮打字机，重试重新流式
        text = await callPlanner(16000);
        parsed = parsePlannerReply(text);
      }
      if (!parsed) {
        // 无 JSON：当纯讨论展示（剥掉思考块后正文）
        setTurns((prev) => [...prev, { role: 'assistant', text: text.trim() || '（空回复）' }]);
        return;
      }
      setTurns((prev) => [...prev, { role: 'assistant', text: parsed.reply, questions: parsed.questions }]);
      if (parsed.proposal) setProposal(parsed.proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败，请重试');
    } finally {
      setStreamingText(null);
      setBusy(false);
    }
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
    <div className="flex h-screen flex-col bg-[hsl(var(--bg))] text-[hsl(var(--fg))]">
      {/* 顶栏 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[hsl(var(--border-soft))] px-4">
        <div className="flex items-center gap-2">
          <span>🪄</span>
          <h1 className="text-base font-semibold">AI 创作向导</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={resetSession}
            data-testid="planner-reset"
            className="rounded px-2 py-1 text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]"
          >
            🗑 重开
          </button>
          <button
            type="button"
            onClick={() => navigate('/m/create')}
            className="rounded px-2 py-1 text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]"
          >
            📱 移动端
          </button>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded px-2 py-1 text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))]"
          >
            返回书架
          </button>
        </div>
      </header>

      {/* 聊天流 + 策划案卡片 */}
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 overflow-y-auto px-4 py-6">
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
              {t.questions && t.questions.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-[hsl(var(--border-soft))] pt-2 text-xs opacity-80" data-testid="planner-questions">
                  {t.questions.map((q, qi) => (
                    <li key={qi}>❓ {q}</li>
                  ))}
                </ul>
              )}
              {t.failed && <div className="mt-1 text-xs text-[hsl(var(--danger))]">本轮失败，可点击重试</div>}
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
              <p className="text-base font-semibold">📋 策划案：{p.title}</p>
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
                🎲 换一版
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
              {importing ? '导入中…（建卡/世界书/作品）' : '✅ 没问题，一键开书（导入人物/世界观/大纲）'}
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* 输入区 */}
      <div className="border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy) void send(input);
            }}
            disabled={busy || importing}
            placeholder="描述你的创作想法，或对策划案提出修改意见…"
            aria-label="向导输入"
            data-testid="planner-input"
            className="h-10 min-w-0 flex-1 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))]"
          />
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
  );
}
