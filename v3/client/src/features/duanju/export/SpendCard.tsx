/**
 * 成本仪表盘（成本优化 C 项）：spendLog 记账 + 盘面统计
 *
 * 让重roll 浪费可见——哪个环节在烧钱一目了然，反哺 prompt 模板迭代。
 */
import { useDuanjuStore } from '../store';
import { spendStats, YUAN_PER_IMAGE } from '../lib/cost/spendStats';

const KIND_LABEL: Record<string, string> = {
  character: '设定图',
  scene: '场景图',
  shot: '旧整图',
  frame: '分镜帧',
};

export default function SpendCard() {
  const project = useDuanjuStore((s) => s.project);
  if (!project) return null;
  const s = spendStats(project);
  const parts = (Object.keys(KIND_LABEL) as Array<keyof typeof s.byKind>)
    .filter((k) => s.byKind[k] > 0)
    .map((k) => `${KIND_LABEL[k]} ${s.byKind[k]}`);

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-[hsl(var(--border-soft))] px-4 py-3 text-xs"
      data-testid="spend-card"
    >
      <span className="font-medium text-[hsl(var(--fg))]">💰 成本盘面</span>
      <span>
        记账 <strong className="text-[hsl(var(--accent))]">{s.logged}</strong> 张 ≈ {s.estCostYuan} 元
      </span>
      {parts.length > 0 && <span className="text-[hsl(var(--fg-muted))]">{parts.join(' · ')}</span>}
      {s.rollCount > 0 && (
        <span className="text-[hsl(var(--danger))]">重roll {s.rollCount} 张（≈ {(s.rollCount * YUAN_PER_IMAGE).toFixed(1)} 元）</span>
      )}
      <span className="text-[hsl(var(--fg-muted))]">现存产物 {s.existingAssets} 张（含升级前存量）</span>
    </div>
  );
}
