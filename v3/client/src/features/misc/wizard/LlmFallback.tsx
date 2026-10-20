/**
 * LLM 兜底 UI 组件：规则抽取效果不佳时的「AI 解析」提示条、规则成功时的小字
 * 「改用 AI 解析」入口（规则与 AI 结果可切换对比）、失败时的错误 + 原始返回折叠、
 * 双份结果共存时的来源切换条。纯展示组件，LLM 调用由父级（OutlineWizard）编排。
 */

/** AI 解析错误态：用户可读消息 + 原始返回（折叠，便于排查） */
export interface AiErrorState {
  message: string;
  raw: string;
}

interface FallbackBarProps {
  /** 规则识别到的角色数（提示文案展示） */
  ruleCount: number;
  /** 预估消耗（千 token） */
  tokenHint: number;
  loading: boolean;
  onRun: () => void;
}

/** 提示条形态：规则效果不佳（0-2 条）时引导用户切换 AI 解析 */
export function LlmFallbackBar({ ruleCount, tokenHint, loading, onRun }: FallbackBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm">
      <span className="flex-1 text-[hsl(var(--fg))]">
        自动识别效果不佳（识别到 {ruleCount} 个角色）。可尝试 AI 解析（消耗约 {tokenHint} 千 token）。
      </span>
      <button
        type="button"
        onClick={onRun}
        disabled={loading}
        data-testid="ai-extract-btn"
        className="min-h-[32px] rounded-lg bg-[hsl(var(--accent))] px-3 text-sm font-medium text-white disabled:opacity-40"
      >
        {loading ? 'AI 解析中…' : 'AI 解析'}
      </button>
    </div>
  );
}

interface RetryHintProps {
  tokenHint: number;
  loading: boolean;
  onRun: () => void;
}

/** 小字入口：规则已成功时提供「改用 AI 解析」对比入口（规则优先原则下的可选增强） */
export function AiRetryHint({ tokenHint, loading, onRun }: RetryHintProps) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={loading}
      data-testid="ai-retry-hint"
      className="self-start text-xs text-[hsl(var(--fg-muted))] underline decoration-dotted underline-offset-4 transition-colors hover:text-[hsl(var(--accent))] disabled:opacity-40"
    >
      {loading ? 'AI 解析中…' : `改用 AI 解析（消耗约 ${tokenHint} 千 token）`}
    </button>
  );
}

/** 错误 + 原始返回折叠（解析失败时保留 raw 便于排查） */
export function AiErrorBox({ error }: { error: AiErrorState }) {
  return (
    <div role="alert" className="rounded-xl border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-400">
      <p>AI 解析失败：{error.message}</p>
      {error.raw && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs opacity-80">查看原始返回</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-[hsl(var(--surface))] p-2 text-xs text-[hsl(var(--fg-muted))]">
            {error.raw}
          </pre>
        </details>
      )}
    </div>
  );
}

interface SourceSwitchProps {
  active: 'rule' | 'llm';
  /** 规则结果是否存在（可切回对比） */
  hasRule: boolean;
  /** AI 结果是否存在（可切去对比） */
  hasLlm: boolean;
  onSwitch: (source: 'rule' | 'llm') => void;
}

/** 来源切换条：规则与 AI 两份结果共存时可来回对比 */
export function AiSourceSwitch({ active, hasRule, hasLlm, onSwitch }: SourceSwitchProps) {
  if (!hasRule || !hasLlm) return null;
  return (
    <div className="flex items-center gap-2 text-xs" role="tablist" aria-label="抽取结果来源切换">
      <span className="text-[hsl(var(--fg-muted))]">结果对比：</span>
      {(['rule', 'llm'] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={active === s}
          onClick={() => onSwitch(s)}
          data-testid={`source-${s}`}
          className={`min-h-[28px] rounded-lg border px-3 transition-colors ${
            active === s
              ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 font-medium text-[hsl(var(--accent))]'
              : 'border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))] hover:border-[hsl(var(--accent))]'
          }`}
        >
          {s === 'rule' ? '规则结果' : 'AI 结果'}
        </button>
      ))}
    </div>
  );
}
