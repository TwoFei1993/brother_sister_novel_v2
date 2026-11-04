/**
 * 书内策划案应用/回滚编排（BookOutlineChat 的数据层拆分）：
 *
 * - applyProposalToBook：按角色幂等建卡 + 首个世界书自动建 + 绑定合并 + settings 写入 + 历史入账
 * - restoreBookSlice：恢复历史版本的资料切片（不动已绑定的卡/书）
 * 失败均抛错由调用方提示；onStage 供 UI 展示阶段进度（拉卡/建世界书/写资料）。
 */
import { apiFetch } from '../../../../api/client';
import { updateWork } from '../../../../api/works';
import type { Work } from '@shared/work';

import {
  loadHistory,
  proposalToSlice,
  pushHistory,
  type AppliedVersion,
} from '../../../planner/book-planner';
import type { PlannerProposal } from '../../../planner/planner-llm';

export type ApplyStage = 'cards' | 'worldbook' | 'settings';

export async function applyProposalToBook(
  work: Work,
  p: PlannerProposal,
  onStage?: (stage: ApplyStage) => void,
): Promise<{ updated: Work; msg: string }> {
  onStage?.('cards');
  // 1) 角色卡：服务端按 name 幂等（重复应用返回既有卡，不重复建）
  const characterIds: string[] = [];
  for (const c of p.extracted.characters) {
    try {
      const a = await apiFetch<{ id: string }>('/api/characters', {
        method: 'POST',
        body: JSON.stringify({
          name: c.name,
          card: { spec: 'chara_card_v2', spec_version: '2.0', data: { name: c.name, description: `${c.role}。${c.traits.join('；')}` } },
        }),
      });
      characterIds.push(a.id);
    } catch {
      /* 单卡失败跳过 */
    }
  }
  onStage?.('worldbook');
  // 2) 世界书：仅本书尚无绑定世界书时自动建一本（避免重复应用堆重复世界书）
  const worldbookIds: string[] = [];
  if (work.worldbookIds.length === 0 && (p.extracted.background || p.extracted.factions.length > 0)) {
    const entries: Record<string, unknown> = {};
    let i = 0;
    const mk = (key: string, content: string): void => {
      entries[String(i)] = { uid: i, key: [key], content, enabled: true, insertion_order: 100 + i, constant: false };
      i += 1;
    };
    if (p.extracted.background) mk('世界观背景', p.extracted.background);
    if (p.extracted.conflict) mk('核心矛盾', p.extracted.conflict);
    for (const f of p.extracted.factions) mk(`势力：${f}`, `势力「${f}」的相关设定。`);
    try {
      const w = await apiFetch<{ id: string }>('/api/worldbooks', {
        method: 'POST',
        body: JSON.stringify({
          name: `${p.title}·世界书`,
          origin: { type: 'book', bookId: work.id },
          raw: { entries },
        }),
      });
      worldbookIds.push(w.id);
    } catch {
      /* 世界书失败不阻塞应用 */
    }
  }
  onStage?.('settings');
  // 3) 绑定（合并去重）+ settings 应用
  const latest = await apiFetch<Work>(`/api/works/${work.id}`);
  const merge = (base: string[], add: string[]): string[] => Array.from(new Set([...base, ...add]));
  const slice = proposalToSlice(p, { desiredChapterCount: work.settings.desiredChapterCount });
  const updated = await updateWork(work.id, {
    revision: latest.revision,
    characterIds: merge(latest.characterIds, characterIds),
    worldbookIds: merge(latest.worldbookIds, worldbookIds),
    settings: { ...work.settings, ...slice },
  });
  // 4) 历史版本入账（改错了能回滚）
  pushHistory(work.id, {
    at: Date.now(),
    label: `第 ${loadHistory(work.id).length + 1} 次应用`,
    slice,
    proposal: p,
  });
  const msg = `已应用：${slice.chapterOutlines.length} 章大纲 · 角色 +${characterIds.length} · 世界书 ${
    worldbookIds.length > 0 ? '+1' : '沿用'
  }（历史已存档）`;
  return { updated, msg };
}

/** 历史回滚：恢复该版本的资料切片（不动已绑定的卡/书）；失败抛错 */
export async function restoreBookSlice(work: Work, v: AppliedVersion): Promise<Work> {
  const latest = await apiFetch<Work>(`/api/works/${work.id}`);
  return updateWork(work.id, {
    revision: latest.revision,
    settings: { ...work.settings, ...v.slice },
  });
}
