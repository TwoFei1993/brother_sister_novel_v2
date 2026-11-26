/**
 * 试验台提示词审批区（设计共识 2026-11-26 第 2.2 节）：扩写结果进可编辑文本框 → 确认出图
 *
 * 超过该通道的长度上限时禁止出图并提示删减，不截断——保证审批的就是送去生成的那一版。
 */
import { RefreshCw } from 'lucide-react';

import { LAB_PROMPT_LIMITS, type LabAspect, type LabProvider, type LabRef } from '@shared/duanju/lab';

import { duanjuFileUrl } from '../../../api/duanju';
import { ASPECT_LABELS, LAB_PROVIDER_LABELS } from '../lib/lab/aspects';

interface Props {
  workId: string;
  /** 当初扩写用的那句简短提示词（提示用户这版提示词是照什么写的） */
  brief: string;
  prompt: string;
  onChange: (text: string) => void;
  /** 这次出图锁定的通道与画幅（扩写那一刻的；之后改输入区不影响这次出图） */
  provider: LabProvider;
  aspect: LabAspect;
  /** 本次出图会用的参考图（审批时看得到送进引擎的是哪些图） */
  refs: readonly LabRef[];
  onRegenerate: () => void;
  onConfirm: () => void;
  /** 扩写进行中（「重新扩写」按钮态） */
  expanding: boolean;
  /** 出图进行中：禁用编辑与按钮，显示已等时长 */
  generating: boolean;
  elapsedSec: number;
}

const btn =
  'flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-medium transition-colors disabled:opacity-40';

export default function LabPromptReview({
  workId,
  brief,
  prompt,
  onChange,
  provider,
  aspect,
  refs,
  onRegenerate,
  onConfirm,
  expanding,
  generating,
  elapsedSec,
}: Props) {
  const limit = LAB_PROMPT_LIMITS[provider];
  const over = prompt.length > limit;
  const hint = generating
    ? provider === 'comfy'
      ? '本地引擎每张约 2–8 分钟，可以切到别的分区，回来还在'
      : '云端生成中，通常十几秒到一分钟'
    : null;

  return (
    <section
      className="rounded-xl border border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] p-4"
      data-testid="lab-review"
    >
      <div className="mb-1 flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">完整提示词（审批后出图）</h3>
        <span className={`shrink-0 text-xs tabular-nums ${over ? 'text-[hsl(var(--danger))]' : 'text-[hsl(var(--fg-muted))]'}`} data-testid="lab-prompt-count">
          {prompt.length}/{limit}
        </span>
      </div>
      <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]">照这句写的：{brief}</p>
      {/* 写明白锁定了什么：之后在输入区切了通道 / 画幅，这次出图不会跟着变 */}
      <p className="mb-2 text-xs text-[hsl(var(--fg-muted))]" data-testid="lab-review-params">
        本次出图按扩写时的参数：{LAB_PROVIDER_LABELS[provider]} · {ASPECT_LABELS[aspect]}
        {refs.length > 0 ? ` · ${refs.length} 张参考图` : ''}——要换就改完后点「重新扩写」
      </p>
      {refs.length > 0 && (
        <div className="mb-2 flex items-center gap-1.5" data-testid="lab-review-refs">
          <span className="shrink-0 text-xs text-[hsl(var(--fg-muted))]">本次出图用的参考图：</span>
          {refs.map((ref, i) => (
            <img
              key={ref.path}
              src={duanjuFileUrl(workId, ref.path)}
              alt={ref.caption || `参考图 ${i + 1}`}
              title={`图${i + 1}：${ref.caption}`}
              className="h-12 w-9 rounded border border-[hsl(var(--border-soft))] object-cover"
            />
          ))}
        </div>
      )}
      <textarea
        value={prompt}
        onChange={(e) => onChange(e.target.value)}
        disabled={generating}
        rows={10}
        aria-label="完整提示词"
        data-testid="lab-prompt"
        className="w-full resize-y rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2 text-sm leading-6 outline-none focus:border-[hsl(var(--accent))] disabled:opacity-60"
      />
      {over && (
        <p className="mt-1.5 text-xs text-[hsl(var(--danger))]" role="alert" data-testid="lab-prompt-over">
          超过该通道上限 {limit} 字——请删减后再出图（不会自动截断）
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onRegenerate}
          disabled={expanding || generating}
          data-testid="lab-reexpand"
          className={`${btn} border border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]`}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {expanding ? '扩写中…' : '重新扩写'}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={expanding || generating || over || !prompt.trim()}
          data-testid="lab-confirm"
          className={`${btn} bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]`}
        >
          {generating ? `出图中… 已等 ${elapsedSec}s` : '确认出图'}
        </button>
      </div>
      {hint && (
        <p className="mt-2 text-xs text-[hsl(var(--fg-muted))]" data-testid="lab-generating-hint">
          {hint}
        </p>
      )}
    </section>
  );
}
