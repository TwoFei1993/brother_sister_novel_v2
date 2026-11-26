/**
 * 拆解审核卡的草稿与保存（从 ReviewCards 抽出：那个文件已过行数上限，逻辑与渲染分开）。
 *
 * - 草稿相对「上次同步到界面的服务端值」判断有没有未保存修改；有修改时不被服务端值覆盖
 *   （流水线写入或出图完成触发的刷新不能冲掉正在编辑的审核卡）
 * - 违审替换：采纳 = 替换剧本原文 + 标记；驳回 = 仅标记；可撤销
 * - 「一键全部采纳」在一个事件里连续处置多条，等不到重渲染——处置时读最新的作品与草稿，
 *   不读渲染时闭包里的值（否则后一条会拿着旧原文、旧清单去写，把前一条的结果冲掉）
 */
import { useEffect, useRef, useState } from 'react';

import type { ReviewCards as ReviewCardsData } from '@shared/duanju';

import { useDuanjuStore } from '../../store';

export type RiskStatus = 'accepted' | 'dismissed' | 'pending';

const copyOf = (c: ReviewCardsData): ReviewCardsData => ({
  ...c,
  eventChain: [...c.eventChain],
  emotionPoints: [...c.emotionPoints],
  visualActions: [...c.visualActions],
  riskReplacements: [...c.riskReplacements],
});

/** 采纳替换后的剧本新文本（找不到原文时原样返回，不破坏） */
function buildScriptPatch(text: string, original: string, replacement: string): { text: string } {
  return { text: text.split(original).join(replacement) };
}

export function useReviewCardsDraft(workId: string) {
  const { project, patch, saving } = useDuanjuStore();
  const [draft, setDraft] = useState<ReviewCardsData | null>(null);
  /** 上次同步到界面的服务端值：草稿相对它判断有没有未保存修改 */
  const lastSyncedRef = useRef<ReviewCardsData | null>(null);
  /** 最新草稿的同步副本：连续处置时读它 */
  const draftRef = useRef<ReviewCardsData | null>(null);

  const applyDraft = (next: ReviewCardsData): void => {
    draftRef.current = next;
    setDraft(next);
  };

  // project 载入 / 外部刷新：没有未保存修改时才同步服务端值
  useEffect(() => {
    if (!project) return;
    const server = copyOf(project.reviewCards);
    const last = lastSyncedRef.current;
    const locallyEdited = draft !== null && last !== null && JSON.stringify(draft) !== JSON.stringify(last);
    lastSyncedRef.current = server;
    if (!locallyEdited) applyDraft(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  function update(next: Partial<ReviewCardsData>): void {
    if (draftRef.current) applyDraft({ ...draftRef.current, ...next });
  }

  /** 把草稿存回服务端；confirmedNext 合并进各卡的确认状态 */
  async function save(next: Partial<ReviewCardsData> = {}, confirmedNext: Record<string, boolean> = {}): Promise<void> {
    const base = draftRef.current;
    if (!base) return;
    const merged: ReviewCardsData = { ...base, ...next, updatedAt: Date.now() };
    applyDraft(merged);
    // 确认状态以服务端最新的为准：草稿里那份可能比流水线刚写入的旧
    const confirmed = useDuanjuStore.getState().project?.reviewCards.confirmed ?? {};
    await patch(workId, { reviewCards: { ...merged, confirmed: { ...confirmed, ...confirmedNext } } });
  }

  /** 违审替换的处置。读最新的作品与草稿，不读渲染时的闭包（见头注释） */
  async function settleRisk(riskId: string, status: RiskStatus): Promise<void> {
    const cur = useDuanjuStore.getState().project;
    const base = draftRef.current ?? cur?.reviewCards;
    if (!cur || !base) return;
    const risks = base.riskReplacements.map((r) => (r.id === riskId ? { ...r, status } : r));
    let scriptPatch: ReturnType<typeof buildScriptPatch> | undefined;
    if (status === 'accepted') {
      const risk = risks.find((r) => r.id === riskId);
      if (risk) scriptPatch = buildScriptPatch(cur.script.text, risk.original, risk.replacement);
    }
    applyDraft({ ...base, riskReplacements: risks });
    await patch(workId, {
      reviewCards: { ...base, riskReplacements: risks },
      ...(scriptPatch ? { script: { ...cur.script, text: scriptPatch.text, updatedAt: Date.now() } } : {}),
    });
  }

  /** 待处置的替换全部依次采纳 */
  async function acceptAllRisks(): Promise<void> {
    const pending = (draftRef.current?.riskReplacements ?? []).filter((r) => r.status === undefined || r.status === 'pending');
    for (const r of pending) await settleRisk(r.id, 'accepted');
  }

  return { project, draft, saving, update, save, settleRisk, acceptAllRisks };
}
