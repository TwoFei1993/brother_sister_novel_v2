/**
 * 移动端音色选择器（创作+阅读共用）：
 * 按分组展示全部候选音色——免费 Edge 18 声 + MiniMax 全量 60 声（角色/旁白播音/粤语），点选即切换。
 */
import type { CastGroup } from '../../lib/tts/mobile-cast';
import { ALL_VOICES } from '../../lib/tts/mobile-cast';

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

export default function VoicePicker({ current, onChange, label = '朗读音色' }: Props) {
  return (
    <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3" data-testid="voice-picker">
      <p className="mb-2 text-xs font-medium text-[hsl(var(--fg-muted))]">{label}</p>
      {GROUPS.map(({ group, label: groupLabel }) => (
        <div key={group} className="mb-2 last:mb-0">
          <p className="mb-1.5 text-[10px] text-[hsl(var(--fg-muted))]">{groupLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_VOICES.filter((v) => v.group === group).map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => onChange(v.id)}
                data-testid={`voice-pick-${v.id}`}
                className={`h-7 rounded-full border px-2.5 text-xs transition-colors ${
                  current === v.id
                    ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
                    : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
                }`}
              >
                {v.name}
                <span className="ml-1 opacity-60">{v.gender === 'female' ? '女' : '男'}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
