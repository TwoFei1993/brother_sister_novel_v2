/**
 * 新建作品的「写作风格 + 内容形态」选择（桌面建书弹窗与手机端建书弹窗共用）。
 *
 * 背景（用户反馈 2026-11-24）：手机端新建小说看不到这两个下拉——此前分别只加在了桌面端
 * NewWorkDialog（风格/形态），手机端建书只提交标题与题材。抽成共用组件后两个入口同步。
 */
import { FORMAT_LABELS, WRITING_STYLE_LABELS, formatPresetOf, type FormatType, type WritingStyle } from '@shared/work';

interface Props {
  writingStyle: WritingStyle;
  format: FormatType;
  onStyleChange: (v: WritingStyle) => void;
  onFormatChange: (v: FormatType) => void;
  /** select 样式类（两端壳层传入——桌面与移动的输入框高度/配色一致，由各自主题决定） */
  selectClass: string;
  /** option 样式类（可选，桌面端用于跟随主题） */
  optionClass?: string;
}

export default function NewWorkOptions({
  writingStyle,
  format,
  onStyleChange,
  onFormatChange,
  selectClass,
  optionClass,
}: Props) {
  const tpl = formatPresetOf(format);
  const labelCls = 'mb-1 block text-sm text-[hsl(var(--fg-muted))]';
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
