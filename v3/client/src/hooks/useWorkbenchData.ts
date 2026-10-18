/**
 * C 工作台数据钩子（设计 §7.1 C 视图侧栏数据面）
 *
 * - entryIndex：绑定世界书 → 全量条目索引（id="bookId:uid"，与 extra.activatedEntries
 *   的形态一致），label 取 comment || 首个 key || content 截断
 * - quickDirectives：作品级快速指令读写（work.settings.quickDirectives），
 *   乐观生效 + PATCH work（revision 乐观锁，失败回滚并告警）
 * - 资产拉取复用 loadAssembleAssets（与生成同一资产源，绑定变化即刷新）
 */
import { useEffect, useMemo, useState } from 'react';

import { updateWork } from '../api/works';
import { loadAssembleAssets } from './generation-pipeline';
import type { WorldbookEntryRef } from '../features/workbench/bench/ActivatedList';
import { useWorkStore } from '../stores/work';
import type { Work } from '@shared/work';

/** content 截断长度（无 comment/key 时的兜底标签） */
const LABEL_CLIP = 30;

/** 绑定世界书 → 条目索引（comment || 首个 key || content 截断） */
function buildEntryIndex(work: Work, worldbooks: Awaited<ReturnType<typeof loadAssembleAssets>>['worldbooks']): WorldbookEntryRef[] {
  const refs: WorldbookEntryRef[] = [];
  for (const book of worldbooks) {
    const entries = book.raw?.entries ?? {};
    for (const [uid, entry] of Object.entries(entries)) {
      const firstKey = entry.key?.find((k) => k.trim() !== '');
      const content = (entry.content ?? '').replace(/\s+/g, ' ').trim();
      refs.push({
        id: `${book.id}:${uid}`,
        label: entry.comment?.trim() || firstKey || (content ? `${content.slice(0, LABEL_CLIP)}…` : `条目 ${uid}`),
      });
    }
  }
  return refs;
}

export interface WorkbenchData {
  /** 全量世界书条目索引（C 侧栏激活灯） */
  entryIndex: WorldbookEntryRef[];
  /** 作品级快速指令（settings.quickDirectives ?? []） */
  quickDirectives: string[];
  /** 追加一条快速指令（去重，PATCH） */
  addQuickDirective: (text: string) => Promise<void>;
  /** 按下标删除快速指令（PATCH） */
  removeQuickDirective: (index: number) => Promise<void>;
}

export function useWorkbenchData(work: Work): WorkbenchData {
  const setWork = useWorkStore((s) => s.setWork);
  const [assets, setAssets] = useState<Awaited<ReturnType<typeof loadAssembleAssets>> | null>(null);

  // 绑定资产变化（设置抽屉保存 → 新 work 引用）即刷新索引；失败静默保留旧索引
  useEffect(() => {
    let alive = true;
    loadAssembleAssets(work)
      .then((a) => {
        if (alive) setAssets(a);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [work]);

  const entryIndex = useMemo(() => (assets ? buildEntryIndex(work, assets.worldbooks) : []), [assets, work]);
  const quickDirectives = work.settings.quickDirectives ?? [];

  /** 快速指令写回：乐观 setWork + PATCH（revision 乐观锁），失败回滚 */
  async function saveQuickDirectives(next: string[]): Promise<void> {
    const prev = work;
    const settings = { ...work.settings, quickDirectives: next };
    setWork({ ...work, settings });
    try {
      setWork(await updateWork(work.id, { revision: work.revision, settings }));
    } catch {
      console.warn('[useWorkbenchData] 快速指令持久化失败，已回滚');
      setWork(prev);
    }
  }

  const addQuickDirective = async (text: string): Promise<void> => {
    const t = text.trim();
    if (!t || quickDirectives.includes(t)) return;
    await saveQuickDirectives([...quickDirectives, t]);
  };

  const removeQuickDirective = async (index: number): Promise<void> => {
    if (index < 0 || index >= quickDirectives.length) return;
    await saveQuickDirectives(quickDirectives.filter((_, i) => i !== index));
  };

  return { entryIndex, quickDirectives, addQuickDirective, removeQuickDirective };
}
