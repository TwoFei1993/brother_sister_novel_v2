/**
 * 素材绑定分区（Phase2 补桌面能力）：本书绑定的角色/世界书/势力查看与选用
 *
 * - 三组列表：已绑素材（名称来自素材库）；「＋选用」弹层列出库中全部素材点选切换
 * - 选用弹层按「归属书」二级分组（防同名卡误选，联测反馈）：本书绑定中的置顶，
 *   其余按原归属书名分组，外部/无归属殿后
 * - 绑定写入：PATCH work 的 characterIds/worldbookIds/factionIds（初始绑定，全书生效；
 *   章节级 fromChapter 绑定走待绑定确认流，见 pending-assets.ts）
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';

import { apiFetch } from '../../../api/client';
import { listWorks } from '../../../api/works';
import type { FactionAsset } from '@shared/assets/faction';
import type { CharacterAsset } from '@shared/card';
import type { Work } from '@shared/work';
import type { WorldbookAsset } from '@shared/worldbook';

type Kind = 'character' | 'worldbook' | 'faction';

interface AssetRef {
  id: string;
  name: string;
  /** 归属三态（全量接口返回；浅列表无此字段） */
  origin?: { type: 'book'; bookId: string } | { type: 'external'; note: string } | { type: 'none' };
}

const ENDPOINT: Record<Kind, string> = {
  character: '/api/characters',
  worldbook: '/api/worldbooks',
  faction: '/api/factions',
};

const LABEL: Record<Kind, string> = { character: '角色卡', worldbook: '世界书', faction: '势力介绍' };

/** 全量拉取（含 origin；数量级为个人素材库，直接全量） */
async function listFull(kind: Kind): Promise<AssetRef[]> {
  const r = await apiFetch<AssetRef[]>(ENDPOINT[kind]);
  return Array.isArray(r) ? r : [];
}

export default function BindingsPane({
  work,
  onUpdated,
}: {
  work: Work;
  onUpdated: (w: Work) => void;
}) {
  const [refs, setRefs] = useState<Partial<Record<Kind, AssetRef[]>> | null>(null);
  const [bookTitles, setBookTitles] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listFull('character'), listFull('worldbook'), listFull('faction'), listWorks()])
      .then(([cs, wbs, fas, works]) => {
        setRefs({ character: cs, worldbook: wbs, faction: fas });
        setBookTitles(Object.fromEntries(works.map((w) => [w.id, w.title])));
      })
      .catch(() => setError('素材列表加载失败'));
  }, []);

  const boundIds = (kind: Kind): string[] =>
    kind === 'character' ? work.characterIds : kind === 'worldbook' ? work.worldbookIds : (work.factionIds ?? []);
  const nameOf = (kind: Kind, id: string): string =>
    refs?.[kind]?.find((r) => r.id === id)?.name ?? id.slice(0, 8);

  /** 切换绑定（勾选/取消）：取最新 revision 后 PATCH 对应 ids 数组 */
  async function toggleBind(kind: Kind, assetId: string): Promise<void> {
    setError(null);
    try {
      const latest = await apiFetch<Work>(`/api/works/${work.id}`);
      const current = boundIds(kind);
      const nextIds = current.includes(assetId) ? current.filter((x) => x !== assetId) : [...current, assetId];
      const patchBody: Record<string, unknown> = { revision: latest.revision };
      if (kind === 'character') patchBody.characterIds = nextIds;
      else if (kind === 'worldbook') patchBody.worldbookIds = nextIds;
      else patchBody.factionIds = nextIds;
      const updated = await apiFetch<Work>(`/api/works/${work.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patchBody),
      });
      onUpdated(updated);
    } catch {
      setError('绑定保存失败（可能版本冲突），请重试');
    }
  }

  /** 选用弹层的分组：本书已绑 → 其他书（按书名）→ 外部/无归属 */
  const pickerGroups = useMemo(() => {
    if (!picking || !refs) return [] as { label: string; items: AssetRef[] }[];
    const all = refs[picking] ?? [];
    const groups = new Map<string, AssetRef[]>();
    for (const r of all) {
      let label: string;
      if (r.origin?.type === 'book') label = `《${bookTitles[r.origin.bookId] ?? '未知作品'}》`;
      else if (r.origin?.type === 'external') label = `外部：${r.origin.note}`;
      else label = '外部 / 无归属';
      (groups.get(label) ?? groups.set(label, []).get(label)!).push(r);
    }
    // 排序：本书绑定中的最前 → 其他书（按书名） → 外部/无归属殿后
    const order = [...groups.keys()].sort((a, b) => {
      const rank = (l: string) => (l.startsWith('《') ? 0 : l.startsWith('外部') ? 2 : 1);
      return rank(a) - rank(b) || a.localeCompare(b, 'zh');
    });
    return order.map((label) => ({ label, items: groups.get(label)! }));
  }, [picking, refs, bookTitles]);

  const GROUPS: ReadonlyArray<{ kind: Kind; ids: string[] }> = [
    { kind: 'character', ids: work.characterIds },
    { kind: 'worldbook', ids: work.worldbookIds },
    { kind: 'faction', ids: work.factionIds ?? [] },
  ];

  return (
    <div className="flex flex-col gap-3 px-4 py-3" data-testid="bindings-pane">
      {error && <p className="rounded-lg bg-[hsl(var(--danger))]/10 p-2 text-xs text-[hsl(var(--danger))]">{error}</p>}
      {GROUPS.map(({ kind, ids }) => (
        <section key={kind} className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="m-serif text-sm font-semibold">{LABEL[kind]}（{ids.length}）</h2>
            <button
              type="button"
              onClick={() => setPicking(kind)}
              data-testid={`bind-add-${kind}`}
              className="rounded-lg border border-[hsl(var(--border-soft))] px-2.5 py-1 text-xs text-[hsl(var(--accent))]"
            >
              ＋ 选用
            </button>
          </div>
          {ids.length === 0 && <p className="text-xs text-[hsl(var(--fg-muted))]">未绑定——点「＋ 选用」从素材库选取</p>}
          <ul className="flex flex-wrap gap-1.5">
            {ids.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => void toggleBind(kind, id)}
                  title="点击取消绑定"
                  className="rounded-full bg-[hsl(var(--accent))]/10 px-2.5 py-1 text-xs text-[hsl(var(--accent))]"
                >
                  {nameOf(kind, id)} <X className="inline h-3.5 w-3.5 align-[-1px]" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* 选用弹层：按归属书二级分组，点选=绑定 */}
      {picking && refs && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setPicking(null)}>
          <div
            className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-[hsl(var(--surface))] p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
            data-testid={`bind-picker-${picking}`}
          >
            <h3 className="mb-3 text-sm font-semibold">选用{LABEL[picking]}（按归属分组 · 点选绑定）</h3>
            {pickerGroups.length === 0 && (
              <p className="py-4 text-center text-xs text-[hsl(var(--fg-muted))]">素材库暂无{LABEL[picking]}（桌面端「资产库」可导入）</p>
            )}
            {pickerGroups.map(({ label, items }) => (
              <section key={label} className="mb-3">
                <h4 className="mb-1 text-xs text-[hsl(var(--fg-muted))]">{label}</h4>
                <ul className="flex flex-col gap-1">
                  {items.map((r) => {
                    const bound = boundIds(picking).includes(r.id);
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => void toggleBind(picking, r.id)}
                          className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                            bound ? 'bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]' : ''
                          }`}
                        >
                          {r.name} {bound && <Check className="inline h-3.5 w-3.5 align-[-1px]" aria-hidden />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
