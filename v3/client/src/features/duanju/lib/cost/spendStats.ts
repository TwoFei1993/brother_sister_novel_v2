/**
 * 成本统计（成本优化 C 项）：spendLog 记账 + 现存产物盘面 → 仪表盘数据
 *
 * - logged：升级到记账后的生成张数（按 kind 分桶）
 * - rollCount：重roll 张数（同 kind:refId:note 重复出现，次数-1 求和）
 * - existingAssets：现存产物盘面（角色设定图 + 场景图 + 分镜帧/旧整图）——升级前存量无日志
 * - estCostYuan：按单价估算（云端唯一计费通道 seedream ≈ 0.12 元/张；本地 ComfyUI 免费不计）
 */
import type { DuanjuProject, SpendEntry } from '@shared/duanju';

/** seedream 单张约 0.12 元（BatchBar 同口径；minimax 通道已移除） */
export const YUAN_PER_IMAGE = 0.12;

export interface SpendStats {
  logged: number;
  byKind: Record<SpendEntry['kind'], number>;
  rollCount: number;
  existingAssets: number;
  estCostYuan: number;
  /** 本地 ComfyUI 免费生图张数（不进金额账，但要展示——否则用户看不到生成量） */
  freeCount: number;
}

export function spendStats(project: DuanjuProject): SpendStats {
  const all = project.spendLog ?? [];
  // 本地 ComfyUI 免费图（note 标注「本地免费」）不计成本账，张数单独统计展示
  const freeLog = all.filter((e) => (e.note ?? '').includes('本地免费'));
  const log = all.filter((e) => !(e.note ?? '').includes('本地免费'));
  const byKind: Record<SpendEntry['kind'], number> = { character: 0, scene: 0, shot: 0, frame: 0 };
  const counts = new Map<string, number>();
  for (const e of log) {
    byKind[e.kind] += 1;
    const key = `${e.kind}:${e.refId}:${e.note ?? ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let rollCount = 0;
  for (const n of counts.values()) rollCount += Math.max(0, n - 1);
  const existingAssets =
    project.characters.reduce((n, c) => n + (c.sheetImages?.length ?? 0), 0) +
    project.scenes.reduce((n, s) => n + (s.images?.length ?? 0), 0) +
    project.shots.reduce(
      (n, s) => n + (s.frames?.length ?? 0) + (s.gridImage ? 1 : 0),
      0,
    );
  return {
    logged: log.length,
    byKind,
    rollCount,
    existingAssets,
    estCostYuan: Math.round(log.length * YUAN_PER_IMAGE * 10) / 10,
    freeCount: freeLog.length,
  };
}
