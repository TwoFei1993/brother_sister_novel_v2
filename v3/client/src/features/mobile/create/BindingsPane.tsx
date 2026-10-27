/**
 * 素材绑定分区（Phase2 补桌面能力）：本书绑定的角色/世界书/势力查看与选用
 *
 * - 三组列表：已绑素材（名称来自素材库）；「＋选用」弹层列出库中全部素材点选切换
 * - 绑定写入：PATCH work 的 characterIds/worldbookIds/factionIds（初始绑定，全书生效；
 *   章节级 fromChapter 绑定走待绑定确认流，见 pending-assets.ts）
 */
import { useEffect, useState } from 'react';

import { apiFetch } from '../../../api/client';
import type { FactionAsset } from '@shared/assets/faction';
import type { CharacterAsset } from '@shared/card';
import type { Work } from '@shared/work';
import type { WorldbookAsset } from '@shared/worldbook';

type Kind = 'character' | 'worldbook' | 'faction';

interface Ref {
  id: string;
  name: string;
}

const ENDPOINT: Record<Kind, string> = {
  character: '/api/characters',
  worldbook: '/api/worldbooks',
  faction: '/api/factions',
};

const LABEL: Record<Kind, string> = { character: '角色卡', worldbook: '世界书', faction: '势力介绍' };

async function listRefs(kind: Kind): Promise<Ref[]> {
  const r = await apiFetch<Ref[]>(ENDPOINT[kind]);
  return Array.isArray(r) ? r : [];
}

export default function BindingsPane({
  work,
  onUpdated,
}: {
  work: Work;
  onUpdated: (w: Work) => void;
}) {
  const [refs, setRefs] = useState<Partial<Record<Kind, Ref[]>> | null>(null);
  const [picking, setPicking] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listRefs('character'), listRefs('worldbook'), listRefs('faction')])
      .then(([cs, wbs, fas]) => setRefs({ character: cs, worldbook: wbs, faction: fas }))
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
                  {nameOf(kind, id)} ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* 选用弹层：列出素材库全部该项素材，点选=绑定 */}
      {picking && refs && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setPicking(null)}>
          <div
            className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-[hsl(var(--surface))] p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
            data-testid={`bind-picker-${picking}`}
          >
            <h3 className="mb-2 text-sm font-semibold">选用{LABEL[picking]}（点选绑定 / 再点取消）</h3>
            <ul className="flex flex-col gap-1">
              {(refs[picking] ?? []).map((r) => {
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
                      {r.name} {bound && '✓'}
                    </button>
                  </li>
                );
              })}
              {(refs[picking] ?? []).length === 0 && (
                <p className="py-4 text-center text-xs text-[hsl(var(--fg-muted))]">素材库暂无{LABEL[picking]}（桌面端「资产库」可导入）</p>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
