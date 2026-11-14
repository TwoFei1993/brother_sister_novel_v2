/**
 * 道具资产分区（drama-skills P2-12）：跨镜关键道具的文字锚点（信物/凶器/手机）。
 * 一期纯文字 spec（注入帧/视频 prompt 保一致）；名称+锚点即可，图通道后续按需。
 */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { useDuanjuStore } from '../store';
import type { DuanjuProp } from '@shared/duanju';

const inputCls =
  'w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--accent))]';

export default function PropsSection({ workId }: { workId: string }) {
  const { project, patch } = useDuanjuStore();
  const [draft, setDraft] = useState('');

  if (!project) return null;
  const props = project.props ?? [];

  async function add(): Promise<void> {
    const name = draft.trim();
    if (!name) return;
    const next: DuanjuProp = {
      id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      spec: '',
      images: [],
      updatedAt: Date.now(),
    };
    await patch(workId, { props: [...props, next] });
    setDraft('');
  }

  async function update(id: string, fields: Partial<DuanjuProp>): Promise<void> {
    await patch(workId, {
      props: props.map((p) => (p.id === id ? { ...p, ...fields, updatedAt: Date.now() } : p)),
    });
  }

  async function remove(id: string): Promise<void> {
    // 联动清理：镜头上引用该道具的 propIds 一并移除
    const cur = useDuanjuStore.getState().project;
    if (!cur) return;
    const shots = cur.shots.map((s) =>
      s.propIds?.includes(id) ? { ...s, propIds: s.propIds.filter((x) => x !== id) } : s,
    );
    await patch(workId, { props: props.filter((p) => p.id !== id), shots });
  }

  return (
    <section className="mt-6" data-testid="props-section">
      <h3 className="mb-2 text-sm font-semibold">🎭 关键道具</h3>
      <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]">
        跨镜出现的信物/凶器/手机等——写清颜色/材质/形制，拆镜头自动关联并逐字注入每帧与视频提示词（跨镜一致）。
      </p>
      {props.map((p) => (
        <div key={p.id} className="mb-2 flex items-start gap-2">
          <input
            defaultValue={p.name}
            onBlur={(e) => e.target.value !== p.name && void update(p.id, { name: e.target.value })}
            className={`${inputCls} w-28 shrink-0`}
            aria-label="道具名"
          />
          <input
            defaultValue={p.spec}
            onBlur={(e) => e.target.value !== p.spec && void update(p.id, { spec: e.target.value })}
            placeholder="外观锚点：颜色/材质/形制/磨损（如：银色翻盖旧手机，右下角磕痕，链绳磨损发灰）"
            className={inputCls}
            aria-label="道具锚点"
          />
          <button
            type="button"
            onClick={() => void remove(p.id)}
            className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg))] hover:text-[hsl(var(--danger))]"
            aria-label={`删除道具 ${p.name}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder="新道具名（回车添加，如：母亲的旧怀表）"
          className={inputCls}
          aria-label="新道具名"
          data-testid="prop-add-input"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={!draft.trim()}
          className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-[hsl(var(--border-soft))] px-3 text-xs disabled:opacity-40"
        >
          <Plus className="h-4 w-4" aria-hidden />
          添加
        </button>
      </div>
    </section>
  );
}
