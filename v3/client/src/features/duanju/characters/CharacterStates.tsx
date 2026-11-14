/**
 * 角色状态时间线（drama-skills P2-11）：随集演进的外观/携带状态（血迹/湿衣/绷带/新携带物）。
 * 按集生效（fromEpisode ≤ 当前集时注入帧/视频 prompt）；「第N集起」缺省=全程生效。
 */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { useDuanjuStore } from '../store';
import type { CharacterState, DuanjuCharacter } from '@shared/duanju';

const inputCls =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-xs outline-none focus:border-[hsl(var(--accent))]';

export default function CharacterStates({ workId, character }: { workId: string; character: DuanjuCharacter }) {
  const { project, patch } = useDuanjuStore();
  const [note, setNote] = useState('');
  const [fromEp, setFromEp] = useState('');
  if (!project) return null;
  const states = character.states ?? [];

  async function save(next: CharacterState[]): Promise<void> {
    const cur = useDuanjuStore.getState().project;
    if (!cur) return;
    const characters = cur.characters.map((c) =>
      c.id === character.id ? { ...c, states: next, updatedAt: Date.now() } : c,
    );
    await patch(workId, { characters });
  }

  async function add(): Promise<void> {
    const text = note.trim();
    if (!text) return;
    const ep = Number(fromEp);
    await save([...states, { ...(Number.isInteger(ep) && ep > 0 ? { fromEpisode: ep } : {}), note: text }]);
    setNote('');
    setFromEp('');
  }

  return (
    <details className="mt-2" data-testid="char-states">
      <summary className="cursor-pointer text-xs text-[hsl(var(--fg-muted))]">
        状态时间线{states.length > 0 ? `（${states.length} 条）` : '（血迹/湿衣/绷带等随集变化的外观状态）'}
      </summary>
      <div className="mt-1.5 space-y-1.5">
        {states.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              defaultValue={s.fromEpisode ?? ''}
              onBlur={(e) => {
                const v = e.target.value === '' ? undefined : Number(e.target.value);
                const cur = s.fromEpisode;
                if (v !== cur) void save(states.map((x, j) => (j === i ? { ...x, fromEpisode: v } : x)));
              }}
              placeholder="全程"
              className={`${inputCls} w-16 shrink-0 text-center`}
              aria-label="起始集"
            />
            <input
              defaultValue={s.note}
              onBlur={(e) =>
                e.target.value !== s.note && void save(states.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))
              }
              placeholder="可观察状态（如：右手掌沾血／西装左肩湿透）"
              className={inputCls}
              aria-label="状态描述"
            />
            <button
              type="button"
              onClick={() => void save(states.filter((_, j) => j !== i))}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--danger))]"
              aria-label="删除状态"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <input
            value={fromEp}
            onChange={(e) => setFromEp(e.target.value)}
            placeholder="第N集起"
            className={`${inputCls} w-16 shrink-0 text-center`}
            aria-label="新状态起始集"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            placeholder="新状态（如：左手缠绷带）——生图时自动注入对应集的帧"
            className={inputCls}
            aria-label="新状态描述"
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={!note.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[hsl(var(--border-soft))] disabled:opacity-40"
            aria-label="添加状态"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </details>
  );
}
