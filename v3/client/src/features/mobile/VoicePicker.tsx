/**
 * 移动端音色选择器（创作+阅读共用）：
 * 按分组展示全部候选音色——免费 Edge 18 声 + MiniMax 全量 60 声（角色/旁白播音/粤语），点选即切换；
 * 每个音色旁有「▶」试听（用户需求 2026-11-26：选声前先听一句）。
 */
import { useState } from 'react';

import { ALL_VOICES, type CastGroup } from '../../lib/tts/mobile-cast';
import { previewVoice, useVoicePreview } from '../../lib/tts/voice-preview';

interface Props {
  current: string;
  onChange: (id: string) => void;
  label?: string;
}

/** 分组（顺序即展示顺序） */
const GROUPS: ReadonlyArray<{ group: CastGroup; label: string }> = [
  { group: 'edge', label: '免费 · Edge' },
  { group: 'cast', label: 'MiniMax · 角色' },
  { group: 'narrator', label: 'MiniMax · 旁白播音' },
  { group: 'cantonese', label: 'MiniMax · 粤语' },
];

const pickCls = (active: boolean): string =>
  `h-7 rounded-l-full border px-2.5 text-xs transition-colors ${
    active
      ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
      : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
  }`;
const previewCls = (busy: boolean): string =>
  `h-7 rounded-r-full border border-l-0 px-1.5 text-[11px] ${
    busy ? 'border-[hsl(var(--accent))] text-[hsl(var(--accent))]' : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
  }`;

export default function VoicePicker({ current, onChange, label = '朗读音色' }: Props) {
  const preview = useVoicePreview();
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  function tryPreview(id: string): void {
    setPreviewErr(null);
    void previewVoice(id).catch((e: unknown) => setPreviewErr(e instanceof Error ? e.message : '试听失败'));
  }

  return (
    <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3" data-testid="voice-picker">
      <p className="mb-2 text-xs font-medium text-[hsl(var(--fg-muted))]">{label} · 点 ▶ 试听</p>
      {GROUPS.map(({ group, label: groupLabel }) => (
        <div key={group} className="mb-2 last:mb-0">
          <p className="mb-1.5 text-[10px] text-[hsl(var(--fg-muted))]">{groupLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_VOICES.filter((v) => v.group === group).map((v) => {
              const busy = preview.status !== 'idle' && preview.id === v.id;
              const mark = busy && preview.status === 'loading' ? '…' : busy ? '■' : '▶';
              return (
                <span key={v.id} className="inline-flex items-center">
                  <button
                    type="button"
                    onClick={() => onChange(v.id)}
                    data-testid={`voice-pick-${v.id}`}
                    className={pickCls(current === v.id)}
                  >
                    {v.name}
                    <span className="ml-1 opacity-60">{v.gender === 'female' ? '女' : '男'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => tryPreview(v.id)}
                    aria-label={`试听${v.name}`}
                    aria-pressed={busy}
                    title={busy ? '停止试听' : `试听${v.name}`}
                    data-testid={`voice-preview-${v.id}`}
                    className={previewCls(busy)}
                  >
                    {mark}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      ))}
      {previewErr && (
        <p className="mt-2 text-xs text-[hsl(var(--danger))]" role="alert">
          {previewErr}
        </p>
      )}
    </div>
  );
}
