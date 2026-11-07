/**
 * 拆解审核卡（共识 D5 / 资料第 2 课）
 *
 * 六张卡（剧情概括/冲突/人物关系/事件链/情绪点/可视化动作）逐项可编辑、逐卡确认；
 * 违审替换：accepted 时把剧本原文中的 original 替换为 replacement（同步改剧本）。
 * 集列表只读展示（分镜 tab 的拆镜头依据）。
 */
import { useEffect, useState } from 'react';
import { Check, Undo2 } from 'lucide-react';

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

  const inputCls =
    'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--accent))]';
  const confirmBtn = (k: CardKey) => (
    <button
      type="button"
      onClick={() => void save(undefined, { [k]: !confirmedMap[k] })}
      className={`flex h-7 items-center gap-1 rounded-full border px-2 text-[11px] ${
        confirmedMap[k]
          ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]'
          : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
      }`}
      aria-label={`确认${k}`}
    >
      <Check className="h-3 w-3" aria-hidden />
      {confirmedMap[k] ? '已确认' : '确认'}
    </button>
  );

  return (
    <section className="rounded-xl border border-[hsl(var(--border-soft))]" data-testid="duanju-review-cards">
      <header className="flex items-center justify-between border-b border-[hsl(var(--border-soft))] px-4 py-3">
        <h3 className="text-sm font-semibold">拆解审核卡</h3>
        <span className="text-xs text-[hsl(var(--fg-muted))]">
          {confirmedCount === ALL_KEYS.length ? '✅ 全部确认' : `已确认 ${confirmedCount}/${ALL_KEYS.length}`}
        </span>
      </header>

      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        {TEXT_CARDS.map((c) => (
          <div key={c.key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{c.title}</span>
              {confirmBtn(c.key)}
            </div>
            <textarea
              value={String(draft[c.key] ?? '')}
              onChange={(e) => update({ [c.key]: e.target.value } as Partial<ReviewCardsData>)}
              onBlur={() => void save()}
              rows={c.rows}
              placeholder={c.hint}
              className={inputCls}
            />
          </div>
        ))}
        {LIST_CARDS.map((c) => {
          const items = draft[c.key] as string[];
          return (
            <div key={c.key} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{c.title}</span>
                {confirmBtn(c.key)}
              </div>
              <textarea
                value={items.join('\n')}
                onChange={(e) => update({ [c.key]: e.target.value.split('\n') } as Partial<ReviewCardsData>)}
                onBlur={() => void save()}
                rows={Math.min(6, Math.max(3, items.length + 1))}
                placeholder={`${c.hint}（一行一项）`}
                className={inputCls}
              />
            </div>
          );
        })}
      </div>

      {cards.riskReplacements.length > 0 && (
        <div className="border-t border-[hsl(var(--border-soft))] px-4 py-4">
          <h4 className="mb-2 text-xs font-medium">⚠️ 违审替换建议（采纳即改写剧本原文）</h4>
          <ul className="space-y-2">
            {cards.riskReplacements.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1.5 rounded-lg border border-[hsl(var(--border-soft))] px-3 py-2 text-xs sm:flex-row sm:items-center"
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

      {project.episodes.length > 0 && (
        <div className="border-t border-[hsl(var(--border-soft))] px-4 py-4">
          <h4 className="mb-2 text-xs font-medium">集列表（分镜 tab 拆镜头的依据，可在分镜 tab 增删）</h4>
          <ol className="space-y-1 text-xs text-[hsl(var(--fg-muted))]">
            {project.episodes.map((ep) => (
              <li key={ep.id}>
                第 {ep.index} 集《{ep.title}》— {ep.synopsis}
              </li>
            ))}
          </ol>
        </div>
      )}

      {saving && <p className="px-4 pb-3 text-[11px] text-[hsl(var(--fg-muted))]">保存中…</p>}
    </section>
  );
}

/** accepted 替换的剧本新文本（找不到原文时原样返回，不破坏） */
function buildScriptPatch(text: string, original: string, replacement: string): { text: string } {
  return { text: text.split(original).join(replacement) };
}
