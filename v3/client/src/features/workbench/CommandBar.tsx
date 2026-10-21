/**
 * 底部指挥条（B 视图，设计 §7.1）：指令输入 + ▶续写 + ⚡连写 + 📖按大纲生成 + 🎲换一支 +「继续」/ 停止
 *
 * - ▶续写：指令可空（空 = 无剧情指令自由续写）
 * - ⚡连写：每次续写 3 章（BATCH_CHUNK_SIZE，写到目标章数即停），第一章用输入框指令、后续自由发挥
 * - 📖按大纲生成（反馈⑤）：作品导入章节大纲后出现，从下一章起逐章按大纲写到覆盖的最大章号
 * - 🎲换一支：最后一章多候选时 ◀▶ 切换（PATCH swipeId）；仅一支时 = swipe 重生成（追加候选）
 * -「继续」：断流/停止后 partialKept=true 出现，以半成品重组上下文再发起（§9.2）
 * - 生成中：▶ 变 ⏹ 停止（连写/大纲时附进度 3/50 或 按大纲 x/y）；输入与换一支禁用
 */
import { useEffect, useState, type KeyboardEvent } from 'react';

import FieldHint from '../../components/FieldHint';
import { useGenerationStore } from '../../stores/generation';

interface CommandBarProps {
  streaming: boolean;
  /** 断流/停止后已产出部分保留，「继续」可用 */
  partialKept: boolean;
  /** 最后一章候选数 >1（可 ◀▶ 切换；false 时 🎲 走重生成） */
  canToggleSwipe: boolean;
  /** 候选位置显示，如 "2/3"；无章节为 null */
  swipePosition: string | null;
  /** 作品未加载完成时整体禁用 */
  disabled: boolean;
  /** 换一支动作进行中（重生成期间 🎲 禁用） */
  busy: boolean;
  /** 连写/大纲进度（如 "3/50" / "按大纲 2/7"；null = 空闲） */
  batchProgress: string | null;
  /** 作品已导入章节大纲（chapterOutlines 非空）→ 显示 📖按大纲生成 */
  canOutline: boolean;
  onGenerate: (directive: string) => void;
  /** ⚡连写：携带输入框当前指令作第一章指令（后续章空指令自由发挥） */
  onBatch: (directive: string) => void;
  /** 📖按大纲生成：limit=本次最多写几章（用户在弹层选择；缺省写满大纲覆盖） */
  onByOutline: (limit?: number) => void;
  onToggleSwipe: (delta: 1 | -1) => void;
  /** 🎲 恒为重roll：同指令追加新候选并切到最新（多候选时也可用，与 ◀▶ 切换互补） */
  onRerollLast: () => void;
  onContinue: () => void;
  onStop: () => void;
  /** 外部指令复填（C 工作台侧栏点击快速指令/历史）：注入输入框，消费后回调复位 */
  seedText?: string | null;
  onSeedConsumed?: () => void;
}

const btnBase =
  'flex h-10 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40';

export default function CommandBar({
  streaming,
  partialKept,
  canToggleSwipe,
  swipePosition,
  disabled,
  busy,
  batchProgress,
  canOutline,
  onGenerate,
  onBatch,
  onByOutline,
  onToggleSwipe,
  onRerollLast,
  onContinue,
  onStop,
  seedText = null,
  onSeedConsumed,
}: CommandBarProps) {
  const [directive, setDirective] = useState('');
  // 📖按大纲弹层：点 📖 后展开「本次生成几章」选择（默认 3），确认才发起
  const [outlinePanelOpen, setOutlinePanelOpen] = useState(false);
  const [outlineLimit, setOutlineLimit] = useState(3);
  // 思考流实时指示（推理模型点击后先思考几十秒才出正文，可视化避免「卡死」体感）
  const thinkingLen = useGenerationStore((s) => s.thinkingBuffer.length);

  // 外部指令复填：注入输入框后立即回调复位（允许同一指令再次点击重新注入）
  useEffect(() => {
    if (seedText == null) return;
    setDirective(seedText);
    onSeedConsumed?.();
  }, [seedText, onSeedConsumed]);

  function submit(): void {
    if (disabled || streaming) return;
    onGenerate(directive.trim());
    setDirective('');
  }

  function submitBatch(): void {
    if (disabled || streaming) return;
    onBatch(directive.trim());
    setDirective('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
  }

  function submitOutline(): void {
    const limit = Math.max(1, Math.floor(Number(outlineLimit) || 3));
    onByOutline(limit);
    setOutlinePanelOpen(false);
  }

  return (
    <div className="safe-bottom border-t border-[hsl(var(--border-soft))] bg-[hsl(var(--surface))] px-2 py-2 sm:px-4">
      {/* 审计 H2：移动端折行——输入框 basis-full 独占一行，按钮组换行右接；md 起恢复单行 */}
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
        {streaming ? (
          <>
            <button
              type="button"
              onClick={onStop}
              data-testid="stop-btn"
              className={`${btnBase} flex-1 bg-[hsl(var(--danger))] text-white sm:flex-none sm:px-6`}
            >
              ⏹ 停止{batchProgress ? ` ${batchProgress}` : ''}
            </button>
            {/* 推理模型点击后先思考几十秒才出正文——实时显示思考量，消除「卡死」体感 */}
            {thinkingLen > 0 && (
              <span
                data-testid="thinking-indicator"
                className="flex items-center gap-1 whitespace-nowrap text-xs text-[hsl(var(--fg-muted))]"
              >
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--accent))]" />
                💭 思考中 {thinkingLen} 字
              </span>
            )}
          </>
        ) : (
          <>
            <input
              type="text"
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder="剧情指令（可空，如：兄妹进入遗迹深处…）"
              aria-label="剧情指令"
              data-testid="directive-input"
              className="h-10 min-w-32 flex-1 basis-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 text-sm outline-none placeholder:text-[hsl(var(--fg-muted))] focus:border-[hsl(var(--accent))] disabled:opacity-40 md:basis-0"
            />
            <button
              type="button"
              onClick={submit}
              disabled={disabled || busy}
              data-testid="generate-btn"
              title="按当前指令续写一章；指令可留空由 AI 自由发挥"
              className={`${btnBase} bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]`}
            >
              ▶ 续写
            </button>
            <button
              type="button"
              onClick={submitBatch}
              disabled={disabled || busy}
              data-testid="batch-btn"
              title="一键连写：每次续写 3 章（写到目标章数即停），第一章用当前指令、后续 AI 自由发挥；随时可停止"
              className={`${btnBase} border border-[hsl(var(--accent))] text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/10`}
            >
              ⚡ 连写
            </button>
            {canOutline && (
              <button
                type="button"
                onClick={() => setOutlinePanelOpen((v) => !v)}
                disabled={disabled || busy}
                data-testid="outline-btn"
                title="按大纲生成：可指定本次生成几章（默认 3），每章自动跟随本章要点，随时可停止"
                className={`${btnBase} border border-[hsl(var(--accent))] text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/10`}
              >
                📖 按大纲生成
              </button>
            )}
            {canOutline && outlinePanelOpen && !streaming && (
              <div
                data-testid="outline-panel"
                className="flex basis-full items-center gap-2 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-3 py-2"
              >
                <span className="text-xs text-[hsl(var(--fg-muted))]">本次按大纲生成</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={outlineLimit}
                  onChange={(e) => setOutlineLimit(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  data-testid="outline-limit-input"
                  aria-label="本次生成章数"
                  className="h-8 w-20 rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2 text-sm outline-none focus:border-[hsl(var(--accent))]"
                />
                <span className="text-xs text-[hsl(var(--fg-muted))]">章（默认 3，可随时停止）</span>
                <button
                  type="button"
                  onClick={submitOutline}
                  data-testid="outline-start"
                  className={`${btnBase} bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]`}
                >
                  开始
                </button>
              </div>
            )}
            <FieldHint
              tapToExpand
              text="续写：输入剧情方向（如「兄妹进入遗迹深处」）后 AI 据此写下一章，也可留空让 AI 自由发挥。连写：点一次自动连写到目标章节数，中途点停止即停。"
            />
            {canToggleSwipe ? (
              <div className="flex h-10 shrink-0 items-center rounded-lg border border-[hsl(var(--border-soft))]">
                <button
                  type="button"
                  title="上一支"
                  disabled={disabled}
                  onClick={() => onToggleSwipe(-1)}
                  className="h-full rounded-l-lg px-2.5 text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))] disabled:opacity-40"
                >
                  ◀
                </button>
                <span data-testid="swipe-position" className="min-w-10 text-center text-xs text-[hsl(var(--fg-muted))]">
                  {swipePosition ?? ''}
                </span>
                <button
                  type="button"
                  title="下一支"
                  disabled={disabled}
                  onClick={() => onToggleSwipe(1)}
                  className="h-full rounded-r-lg px-2.5 text-sm text-[hsl(var(--fg-muted))] hover:text-[hsl(var(--fg))] disabled:opacity-40"
                >
                  ▶
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onRerollLast}
                  disabled={disabled || busy}
                  title="换一支：同指令重新生成本章并追加为新候选"
                  data-testid="swipe-btn"
                  className={`${btnBase} border border-[hsl(var(--border-soft))] text-[hsl(var(--fg))] hover:border-[hsl(var(--accent))]`}
                >
                  🎲 换一支
                </button>
                <FieldHint
                  tapToExpand
                  text="换一支：同指令重新生成一个新候选并自动切换过去；想回看旧候选用 ◀▶ 按钮。"
                />
              </>
            )}
          </>
        )}
        {!streaming && partialKept && (
          <button
            type="button"
            onClick={onContinue}
            data-testid="continue-btn"
            className={`${btnBase} bg-[hsl(var(--accent))] text-[hsl(var(--accent-fg))]`}
          >
            继续
          </button>
        )}
      </div>
    </div>
  );
}
