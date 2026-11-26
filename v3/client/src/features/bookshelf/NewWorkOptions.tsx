/**
 * 新建作品的「写作风格 + 故事基调 + 内容形态」选择（桌面建书弹窗与手机端建书弹窗共用）。
 *
 * - 写作风格 / 内容形态：下拉（用户反馈 2026-11-24：手机端建书此前看不到）
 * - 故事基调：多选 + 自定义（用户反馈 2026-11-26：创建时就要能选开心、压抑等情绪，
 *   且要真实生效——settings.storyTones 本就注入设定块，此前建书时没有入口，恒为默认「热血爽文」）
 * - 绑定主预设后预设自带的文风 / 情感基调条目由 NewWorkPresetGroups 渲染（宿主弹窗负责挂载）
 */
import { FORMAT_LABELS, WRITING_STYLE_LABELS, formatPresetOf, StoryToneSchema, type FormatType, type StoryTone, type WritingStyle } from '@shared/work';

interface Props {
  writingStyle: WritingStyle;
  format: FormatType;
  onStyleChange: (v: WritingStyle) => void;
  onFormatChange: (v: FormatType) => void;
  /** 故事基调（内置枚举多选 + 自定义；随 settings 下发） */
  tones: StoryTone[];
  customTone: string;
  onTonesChange: (v: StoryTone[]) => void;
  onCustomToneChange: (v: string) => void;
  /** select 样式类（两端壳层传入——桌面与移动的输入框高度/配色一致，由各自主题决定） */
  selectClass: string;
  /** option 样式类（可选，桌面端用于跟随主题） */
  optionClass?: string;
}

/** 故事基调选项（与内置设定同源枚举；资料页 StylePane 同这份） */
const TONES: readonly StoryTone[] = StoryToneSchema.options;

const chipCls = (on: boolean): string =>
  `min-h-8 rounded-full border px-3 text-xs transition-colors ${
    on
      ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
      : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
  }`;

export default function NewWorkOptions({
  writingStyle,
  format,
  onStyleChange,
  onFormatChange,
  tones,
  customTone,
  onTonesChange,
  onCustomToneChange,
  selectClass,
  optionClass,
}: Props) {
  const tpl = formatPresetOf(format);
  const labelCls = 'mb-1 block text-sm text-[hsl(var(--fg-muted))]';
  const inputCls =
    'mt-2 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--accent))]';
  return (
    <>
      <label className="mb-3 block">
        <span className={labelCls}>写作风格</span>
        <select
          value={writingStyle}
          onChange={(e) => onStyleChange(e.target.value as WritingStyle)}
          data-testid="new-work-style"
          className={selectClass}
        >
          {Object.entries(WRITING_STYLE_LABELS).map(([v, label]) => (
            <option key={v} value={v} className={optionClass}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div className="mb-3">
        <span className={labelCls}>故事基调（情绪，可多选）</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="故事基调" data-testid="new-work-tones">
          {TONES.map((t) => {
            const on = tones.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                data-testid={`new-work-tone-${t}`}
                onClick={() => onTonesChange(on ? tones.filter((x) => x !== t) : [...tones, t])}
                className={chipCls(on)}
              >
                {t}
              </button>
            );
          })}
        </div>
        <input
          value={customTone}
          onChange={(e) => onCustomToneChange(e.target.value)}
          placeholder="自定义基调（如：轻松欢快、日常搞笑）"
          aria-label="自定义基调"
          data-testid="new-work-custom-tone"
          maxLength={60}
          className={inputCls}
        />
      </div>

      <label className="mb-3 block">
        <span className={labelCls}>内容形态</span>
        <select
          value={format}
          onChange={(e) => onFormatChange(e.target.value as FormatType)}
          data-testid="new-work-format"
          className={selectClass}
        >
          {Object.entries(FORMAT_LABELS).map(([v, label]) => (
            <option key={v} value={v} className={optionClass}>
              {label}
            </option>
          ))}
        </select>
        {tpl && (
          <span className="mt-1 block text-[11px] text-[hsl(var(--fg-muted))]" data-testid="new-work-format-hint">
            每章约 {tpl.chapterWords} 字{tpl.chapters > 0 ? ` · 建议 ${tpl.chapters} 章/集完结` : ' · 连载不设限'}
          </span>
        )}
      </label>
    </>
  );
}
