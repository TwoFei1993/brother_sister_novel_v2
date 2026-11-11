/**
 * 拆解审核卡（共识 D5 / 资料第 2 课）——frontend-design 精修版
 *
 * 六张卡（剧情概括/冲突/人物关系/事件链/情绪点/可视化动作）逐项可编辑、逐卡确认；
 * 确认进度条 + 已确认卡降调（扫视即知进度）；人物头像卡；集列表卡化。
 * 违审替换：accepted 时把剧本原文中的 original 替换为 replacement（同步改剧本）。
 */
import { useEffect, useState } from 'react';
import { Check, Undo2, Users } from 'lucide-react';

import { useDuanjuStore } from '../store';
import type { ReviewCards as ReviewCardsData } from '@shared/duanju';

const TEXT_CARDS: ReadonlyArray<{ key: 'summary' | 'conflict' | 'characterRelations'; title: string; hint: string; rows: number }> = [
  { key: 'summary', title: '剧情概括', hint: '100 字内讲清核心故事', rows: 3 },
  { key: 'conflict', title: '主要冲突', hint: '对抗与张力来源', rows: 2 },
  { key: 'characterRelations', title: '人物关系', hint: '谁和谁、什么关系、什么态度', rows: 2 },
];

const LIST_CARDS: ReadonlyArray<{ key: 'eventChain' | 'emotionPoints' | 'visualActions'; title: string; hint: string }> = [
  { key: 'eventChain', title: '事件链', hint: '一行一事件，因果相连' },
  { key: 'emotionPoints', title: '情绪点', hint: '观众该在哪被打动' },
  { key: 'visualActions', title: '可视化动作', hint: '心理描写 → 可见动作' },
];

const ALL_KEYS = [...TEXT_CARDS.map((c) => c.key), ...LIST_CARDS.map((c) => c.key)] as const;
type CardKey = (typeof ALL_KEYS)[number];

export default function ReviewCards({ workId }: { workId: string }) {
  const { project, patch, saving } = useDuanjuStore();
  const [draft, setDraft] = useState<ReviewCardsData | null>(null);

  useEffect(() => {
    if (project) {
      const c = project.reviewCards;
      setDraft({
        ...c,
        eventChain: [...c.eventChain],
        emotionPoints: [...c.emotionPoints],
        visualActions: [...c.visualActions],
        riskReplacements: [...c.riskReplacements],
      });
    }
  }, [project]);

  if (!project || !draft) return null;
  const cards = project.reviewCards;
  const confirmedMap = cards.confirmed ?? {};
  const confirmedCount = ALL_KEYS.filter((k) => confirmedMap[k]).length;
  const progressPct = Math.round((confirmedCount / ALL_KEYS.length) * 100);

  function update(next: Partial<ReviewCardsData>): void {
    setDraft((d) => (d ? { ...d, ...next } : d));
  }

  async function save(next?: Partial<ReviewCardsData>, confirmedNext?: Record<string, boolean>): Promise<void> {
    const merged: ReviewCardsData = { ...(draft ?? cards), ...next, updatedAt: Date.now() };
    setDraft(merged);
    await patch(workId, {
      reviewCards: {
        ...merged,
        confirmed: { ...confirmedMap, ...confirmedNext },
      },
    });
  }

  /** 违审替换：accepted = 替换剧本原文 + 标记；dismissed = 仅标记；可撤销重置 */
  async function settleRisk(riskId: string, status: 'accepted' | 'dismissed' | 'pending'): Promise<void> {
    if (!project) return;
    const risks = (draft?.riskReplacements ?? []).map((r) => (r.id === riskId ? { ...r, status } : r));
    let scriptPatch: undefined | ReturnType<typeof buildScriptPatch>;
    if (status === 'accepted') {
      const risk = risks.find((r) => r.id === riskId);
      if (risk) scriptPatch = buildScriptPatch(project.script.text, risk.original, risk.replacement);
    }
    setDraft((d) => (d ? { ...d, riskReplacements: risks } : d));
    await patch(workId, {
      reviewCards: { ...(draft ?? cards), riskReplacements: risks },
      ...(scriptPatch
        ? {
            script: {
              ...project.script,
              text: scriptPatch.text,
              updatedAt: Date.now(),
            },
          }
        : {}),
    });
  }

  const cardShell = (k: CardKey): string =>
    `group flex flex-col gap-2 rounded-xl border p-4 transition-colors focus-within:border-[hsl(var(--accent))]/60 ${
      confirmedMap[k]
        ? 'border-[hsl(var(--accent))]/40 bg-[hsl(var(--accent))]/[0.04]'
        : 'border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]/50'
    }`;
  const confirmBtn = (k: CardKey) => (
    <button
      type="button"
      onClick={() => void save(undefined, { [k]: !confirmedMap[k] })}
      className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-colors ${
        confirmedMap[k]
          ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]'
          : 'border border-dashed border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))] hover:border-[hsl(var(--accent))]/60 hover:text-[hsl(var(--accent))]'
      }`}
      aria-label={`确认${k}`}
    >
      <Check className="h-3 w-3" aria-hidden />
      {confirmedMap[k] ? '已确认' : '确认'}
    </button>
  );
  const cardTextarea =
    'w-full resize-y bg-transparent text-[13px] leading-6 text-[hsl(var(--fg))] outline-none placeholder:text-[hsl(var(--fg-muted))]/60';

  return (
    <section className="rounded-2xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]/40" data-testid="duanju-review-cards">
      {/* 头部：标题 + 引导语 + 确认进度条 + 主按钮 */}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[hsl(var(--border-soft))] px-5 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="m-serif text-base font-semibold">拆解审核卡</h3>
          <p className="mt-0.5 text-xs text-[hsl(var(--fg-muted))]">AI 已从剧本提取六项创作要素——逐项核对微调后确认，作为分镜拆解的锁定依据</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[hsl(var(--border-soft))]">
              <div
                className="h-full rounded-full bg-[hsl(var(--accent))] transition-all duration-500"
                style={{ width: `${progressPct}%` }}
                data-testid="review-progress"
              />
            </div>
            <span className="text-xs tabular-nums text-[hsl(var(--fg-muted))]">
              {confirmedCount === ALL_KEYS.length ? '✅ 全部确认' : `${confirmedCount}/${ALL_KEYS.length}`}
            </span>
          </div>
          {confirmedCount < ALL_KEYS.length && (
            <button
              type="button"
              onClick={() => void save(undefined, Object.fromEntries(ALL_KEYS.map((k) => [k, true])))}
              className="h-8 rounded-lg bg-[hsl(var(--accent))] px-3 text-xs font-medium text-[hsl(var(--accent-fg))]"
              data-testid="review-confirm-all"
            >
              一键全部确认
            </button>
          )}
        </div>
      </header>

      {/* 人物卡：头像圈 + 名字 + 档案截断 */}
      {project.characters.length > 0 && (
        <div className="border-b border-[hsl(var(--border-soft))] px-5 py-4">
          <h4 className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--fg-muted))]">
            <Users className="h-3.5 w-3.5" aria-hidden />
            出场人物（{project.characters.length}）——详细档案在「角色」tab 维护
          </h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {project.characters.map((c) => (
              <div key={c.id} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]/50 px-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent))]/15 text-xs font-bold text-[hsl(var(--accent))]">
                  {(c.name || '?').slice(0, 1)}
                </span>
                <span className="min-w-0 text-xs">
                  <span className="block truncate font-medium">{c.name || '未命名'}</span>
                  <span className="block truncate text-[11px] text-[hsl(var(--fg-muted))]">{c.profile}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 六张卡：确认态降调（accent 弱化边框+底色），未确认态引导确认 */}
      <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 lg:grid-cols-3">
        {TEXT_CARDS.map((c) => (
          <div key={c.key} className={cardShell(c.key)}>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs font-semibold ${confirmedMap[c.key] ? 'text-[hsl(var(--fg-muted))]' : ''}`}>{c.title}</span>
              {confirmBtn(c.key)}
            </div>
            <textarea
              value={String(draft[c.key] ?? '')}
              onChange={(e) => update({ [c.key]: e.target.value } as Partial<ReviewCardsData>)}
              onBlur={() => void save()}
              rows={Math.max(c.rows, String(draft[c.key] ?? '').split('\n').length + 1)}
              placeholder={c.hint}
              className={`${cardTextarea} min-h-24`}
            />
          </div>
        ))}
        {LIST_CARDS.map((c) => {
          const items = draft[c.key] as string[];
          return (
            <div key={c.key} className={cardShell(c.key)}>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-semibold ${confirmedMap[c.key] ? 'text-[hsl(var(--fg-muted))]' : ''}`}>{c.title}</span>
                {confirmBtn(c.key)}
              </div>
              <textarea
                value={items.join('\n')}
                onChange={(e) => update({ [c.key]: e.target.value.split('\n') } as Partial<ReviewCardsData>)}
                onBlur={() => void save()}
                rows={Math.max(4, items.length + 1)}
                placeholder={`${c.hint}（一行一项）`}
                className={`${cardTextarea} min-h-24`}
              />
            </div>
          );
        })}
      </div>

      {/* 违审替换：danger 左条卡 + 处置按钮 */}
      {cards.riskReplacements.length > 0 && (
        <div className="border-t border-[hsl(var(--border-soft))] px-5 py-4">
          <div className="mb-2.5 flex items-center justify-between">
            <h4 className="text-xs font-medium">⚠️ 违审替换建议（采纳即改写剧本原文）</h4>
            {cards.riskReplacements.some((r) => r.status === undefined || r.status === 'pending') && (
              <button
                type="button"
                onClick={() => {
                  const pending = (draft?.riskReplacements ?? []).filter(
                    (r) => r.status === undefined || r.status === 'pending',
                  );
                  void (async () => {
                    for (const r of pending) await settleRisk(r.id, 'accepted');
                  })();
                }}
                className="h-7 rounded-lg bg-[hsl(var(--accent))] px-2.5 text-[11px] font-medium text-[hsl(var(--accent-fg))]"
                data-testid="risk-accept-all"
              >
                一键全部采纳
              </button>
            )}
          </div>
          <ul className="space-y-2.5">
            {cards.riskReplacements.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-xl border border-[hsl(var(--border-soft))] border-l-2 border-l-[hsl(var(--danger))]/70 bg-[hsl(var(--bg))]/60 px-3.5 py-2.5 text-[13px] sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[hsl(var(--danger))]">原文：{r.original}</p>
                  <p className="text-[hsl(var(--fg-muted))]">改为：{r.replacement}</p>
                </div>
                {r.status === undefined || r.status === 'pending' ? (
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void settleRisk(r.id, 'accepted')}
                      className="h-8 rounded-lg bg-[hsl(var(--accent))] px-3 text-[11px] font-medium text-[hsl(var(--accent-fg))]"
                      data-testid="risk-accept"
                    >
                      采纳
                    </button>
                    <button
                      type="button"
                      onClick={() => void settleRisk(r.id, 'dismissed')}
                      className="h-8 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-[11px] text-[hsl(var(--fg-muted))]"
                    >
                      驳回
                    </button>
                  </div>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-[hsl(var(--fg-muted))]">
                    {r.status === 'accepted' ? '✅ 已采纳' : '⛔ 已驳回'}
                    <button
                      type="button"
                      onClick={() => void settleRisk(r.id, 'pending')}
                      aria-label="撤销处置"
                      className="ml-1 underline"
                    >
                      <Undo2 className="inline h-3 w-3" aria-hidden />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 集列表：集号章 + 标题/梗概 两行卡 */}
      {project.episodes.length > 0 && (
        <div className="border-t border-[hsl(var(--border-soft))] px-5 py-4">
          <h4 className="mb-2.5 text-xs font-medium text-[hsl(var(--fg-muted))]">集列表（分镜 tab 拆镜头的依据，可在分镜 tab 增删）</h4>
          <ol className="grid gap-2 sm:grid-cols-2">
            {project.episodes.map((ep) => (
              <li key={ep.id} className="flex items-start gap-2.5 rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))]/50 px-3 py-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--accent))]/60 text-[11px] font-bold text-[hsl(var(--accent))]">
                  {ep.index}
                </span>
                <span className="min-w-0 text-xs">
                  <span className="block truncate font-medium">《{ep.title}》</span>
                  <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-[hsl(var(--fg-muted))]">{ep.synopsis}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {saving && <p className="px-5 pb-3 text-[11px] text-[hsl(var(--fg-muted))]">保存中…</p>}
    </section>
  );
}

/** accepted 替换的剧本新文本（找不到原文时原样返回，不破坏） */
function buildScriptPatch(text: string, original: string, replacement: string): { text: string } {
  return { text: text.split(original).join(replacement) };
}
