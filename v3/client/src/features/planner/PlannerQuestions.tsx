/**
 * 向导问题的多选交互（反馈：主旨类问题应可多选、多个问题一次提交，而不是逐个发）。
 *
 * - 每个 option 是可切换的选中态（chip 高亮），支持跨问题勾选任意组合
 * - 每题附「其他」：选中展开输入框，自定义答案并入该题（反馈⑤）
 * - 「提交所选」把全部勾选合并成一条消息发送；单选场景选一个提交同样可用
 * - 选中态为组件内部状态：发送后清空；换一轮问题（questions 引用变化）自动重置
 */
import { useEffect, useState } from 'react';
import { CircleHelp } from 'lucide-react';

export interface PlannerQuestion {
  q: string;
  options: string[];
}

interface Props {
  questions: PlannerQuestion[];
  busy: boolean;
  onSend: (text: string) => void;
}

export default function PlannerQuestions({ questions, busy, onSend }: Props) {
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  /** 每题的「其他」自填文本 */
  const [others, setOthers] = useState<Record<number, string>>({});
  /** 每题是否启用「其他」输入 */
  const [otherOpen, setOtherOpen] = useState<Record<number, boolean>>({});

  // 新一轮问题到达时重置勾选
  useEffect(() => {
    setPicked({});
    setOthers({});
    setOtherOpen({});
  }, [questions]);

  const total = Object.values(picked).reduce((n, arr) => n + arr.length, 0);
  const otherCount = Object.entries(others).filter(([, v]) => v.trim() !== '').length;

  function toggle(qi: number, opt: string): void {
    setPicked((p) => {
      const cur = p[qi] ?? [];
      return { ...p, [qi]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
    });
  }

  function submit(): void {
    if (busy || (total === 0 && otherCount === 0)) return;
    const lines = questions
      .map((item, qi) => {
        const sel = picked[qi] ?? [];
        const custom = (others[qi] ?? '').trim();
        const parts = [...sel, ...(custom ? [custom] : [])];
        return parts.length > 0 ? `· ${item.q}：${parts.join('、')}` : null;
      })
      .filter((x): x is string => x !== null);
    if (lines.length === 0) return;
    onSend(`我的选择：\n${lines.join('\n')}`);
    setPicked({});
    setOthers({});
    setOtherOpen({});
  }

  return (
    <div className="mt-2 space-y-3 border-t border-[hsl(var(--border-soft))] pt-2 text-xs" data-testid="planner-questions">
      {questions.map((item, qi) => {
        const custom = (others[qi] ?? '').trim();
        const pickedCount = (picked[qi] ?? []).length + (custom ? 1 : 0);
        return (
          <div key={qi}>
            <p className="mb-1.5 flex items-center gap-1.5">
              <CircleHelp className="h-4 w-4 shrink-0" aria-hidden />
              {item.q}
              {pickedCount > 0 && <span className="text-[10px] text-[hsl(var(--accent))]">已选 {pickedCount}</span>}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {item.options.map((opt) => {
                const on = (picked[qi] ?? []).includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggle(qi, opt)}
                    disabled={busy}
                    data-testid={`planner-option-${qi}-${opt.slice(0, 6)}`}
                    aria-pressed={on}
                    className={`rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40 ${
                      on
                        ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
                        : 'border-[hsl(var(--border-soft))] hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))]'
                    }`}
                  >
                    {opt}
                    {on && <span className="ml-1">✓</span>}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setOtherOpen((p) => ({ ...p, [qi]: !p[qi] }))}
                disabled={busy}
                aria-pressed={Boolean(otherOpen[qi])}
                data-testid={`planner-other-${qi}`}
                className={`rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40 ${
                  otherOpen[qi]
                    ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'
                    : 'border-dashed border-[hsl(var(--border-soft))] text-[hsl(var(--fg-muted))]'
                }`}
              >
                ✏️ 其他
              </button>
            </div>
            {otherOpen[qi] && (
              <input
                value={others[qi] ?? ''}
                onChange={(e) => setOthers((p) => ({ ...p, [qi]: e.target.value }))}
                placeholder="写下你自己的想法…"
                aria-label={`${item.q} 的自定义回答`}
                data-testid={`planner-other-input-${qi}`}
                className="mt-1.5 h-9 w-full rounded-lg border border-[hsl(var(--border-soft))] bg-[hsl(var(--bg))] px-2.5 outline-none focus:border-[hsl(var(--accent))]"
              />
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={submit}
        disabled={busy || (total === 0 && otherCount === 0)}
        data-testid="planner-options-submit"
        className="min-h-[34px] w-full rounded-lg bg-[hsl(var(--accent))] text-xs font-medium text-[hsl(var(--accent-fg))] disabled:opacity-40"
      >
        {total + otherCount > 0 ? `提交所选（${total + otherCount} 项，合并发送）` : '点选上面的选项后一起提交'}
      </button>
    </div>
  );
}
