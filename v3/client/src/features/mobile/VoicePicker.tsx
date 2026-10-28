/**
 * 移动端音色选择器（创作+阅读共用）：
 * 展示全部候选音色（Edge 免费 + MiniMax 高质量），按性别分组，点选即切换。
 */
import { ALL_VOICES } from '../../lib/tts/mobile-cast';

interface Props {
  current: string;
  onChange: (id: string) => void;
  label?: string;
}

export default function VoicePicker({ current, onChange, label = '朗读音色' }: Props) {
  const male = ALL_VOICES.filter((v) => v.gender === 'male');
  const female = ALL_VOICES.filter((v) => v.gender === 'female');
  return (
    <div className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-3" data-testid="voice-picker">
      <p className="mb-2 text-xs font-medium text-[hsl(var(--fg-muted))]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {[...male, ...female].map((v) => (
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
          </button>
        ))}
      </div>
    </div>
  );
}
