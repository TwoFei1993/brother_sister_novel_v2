/**
 * 流水线断点（设计共识 2026-11-26 第 3.6 节）：存 localStorage，页面被回收或刷新后据此续跑。
 *
 * - 主动停止：断点被删除（之后不会自动续跑）
 * - 停靠（剧本写完先停下等审）：断点保留并标 paused，不自动续跑，等用户点继续
 * - 存储不可用 / JSON 损坏 / 不合 schema 的断点按没有处理并清除
 */
import { PipelineCheckpointSchema, type PipelineCheckpoint } from '@shared/duanju';

const key = (workId: string): string => `duanju-pipeline-${workId}`;

export function readCheckpoint(workId: string): PipelineCheckpoint | null {
  try {
    const raw = localStorage.getItem(key(workId));
    if (!raw) return null;
    const parsed = PipelineCheckpointSchema.safeParse(JSON.parse(raw)); // JSON.parse 也在 try 里：损坏的断点不能让打开作品变成一个异常
    if (parsed.success) return parsed.data;
  } catch {
    /* 读不到 / 不是合法 JSON：落到下面清除 */
  }
  clearCheckpoint(workId);
  return null;
}

export function writeCheckpoint(cp: PipelineCheckpoint): void {
  try {
    localStorage.setItem(key(cp.workId), JSON.stringify(PipelineCheckpointSchema.parse(cp)));
  } catch {
    /* 存不进去只影响「页面被回收后续跑」，不阻塞流水线 */
  }
}

export function clearCheckpoint(workId: string): void {
  try {
    localStorage.removeItem(key(workId));
  } catch {
    /* 同上 */
  }
}
