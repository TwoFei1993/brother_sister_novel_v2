/**
 * stale 推导（共识 D3：依赖提醒）：builtFrom 快照 vs 上游当前 updatedAt
 *
 * 纯函数：镜头有图（frames 或旧 gridImage）且任一上游（剧本/出场角色/场景）已变更 → 待刷新。
 * 「烧钱操作不自动跑」——stale 只标记，重生成一律手动。
 *
 * 帧级判定（P2 修复）：有 frameSnapshots 时逐帧比对——单帧重 roll 只刷自己的快照，
 * 其余帧基于旧上游的过时状态不再被洗白（缺快照的帧回退镜级 builtFrom 兜底）。
 */
import type { BuiltFrom, DuanjuProject, DuanjuShot } from '@shared/duanju';

/** 单份快照 vs 当前上游的比对（镜级与帧级共用） */
function snapshotStale(bf: BuiltFrom, shot: DuanjuShot, project: DuanjuProject): boolean {
  if (bf.scriptAt !== undefined && bf.scriptAt !== project.script.updatedAt) return true;
  for (const cid of shot.characterIds) {
    const c = project.characters.find((x) => x.id === cid);
    const was = bf.charAt?.[cid];
    // 关联存在但快照无记录（出图后新增的角色/场景关联）→ 图里没有它，视为待刷新
    if (c && was === undefined) return true;
    if (c && was !== undefined && was !== c.updatedAt) return true;
    // 角色被删除 → 快照里有、现无 → 视为变更
    if (!c && bf.charAt?.[cid] !== undefined) return true;
  }
  if (shot.sceneId) {
    const s = project.scenes.find((x) => x.id === shot.sceneId);
    const was = bf.sceneAt?.[shot.sceneId];
    if (s && was === undefined) return true; // 出图后补设的场景关联
    if (was !== undefined) {
      if (!s) return true; // 场景被删除
      if (was !== s.updatedAt) return true;
    }
  }
  return false;
}

export function isShotStale(shot: DuanjuShot, project: DuanjuProject): boolean {
  const hasImage = !!shot.gridImage || (shot.frames?.length ?? 0) > 0;
  if (!hasImage || !shot.builtFrom) return false;
  const bf = shot.builtFrom;
  // 帧级：任一帧的独立快照与上游不一致 → 该镜有待刷新帧
  if (bf.frameSnapshots && Object.keys(bf.frameSnapshots).length > 0) {
    for (const snap of Object.values(bf.frameSnapshots)) {
      if (snap && snapshotStale(snap, shot, project)) return true;
    }
  }
  // 镜级兜底：无帧快照的帧（含旧整图 gridImage）按镜级快照判定
  return snapshotStale(bf, shot, project);
}

/** 分镜 tab 顶部聚合：{stale 数, 有图镜头数} */
export function storyboardHealth(project: DuanjuProject, episodeId: string): { stale: number; withImage: number; total: number } {
  const shots = project.shots.filter((s) => s.episodeId === episodeId);
  return {
    stale: shots.filter((s) => isShotStale(s, project)).length,
    withImage: shots.filter((s) => (s.frames?.length ?? 0) > 0 || !!s.gridImage).length,
    total: shots.length,
  };
}
