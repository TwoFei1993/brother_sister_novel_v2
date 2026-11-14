/**
 * stale 推导（共识 D3：依赖提醒）：shot.builtFrom 快照 vs 上游当前 updatedAt
 *
 * 纯函数：镜头有图（frames 或旧 gridImage）且任一上游（剧本/出场角色/场景）已变更 → 待刷新。
 * 「烧钱操作不自动跑」——stale 只标记，重生成一律手动。
 */
import type { DuanjuProject, DuanjuShot } from '@shared/duanju';

export function isShotStale(shot: DuanjuShot, project: DuanjuProject): boolean {
  const hasImage = !!shot.gridImage || (shot.frames?.length ?? 0) > 0;
  if (!hasImage || !shot.builtFrom) return false;
  const bf = shot.builtFrom;
  if (bf.scriptAt !== undefined && bf.scriptAt !== project.script.updatedAt) return true;
  for (const cid of shot.characterIds) {
    const c = project.characters.find((x) => x.id === cid);
    const was = bf.charAt?.[cid];
    // P2 修复：关联存在但快照无记录（出图后新增的角色/场景关联）→ 图里没有它，视为待刷新
    if (c && was === undefined) return true;
    if (c && was !== undefined && was !== c.updatedAt) return true;
    // 角色被删除 → 快照里有、现无 → 视为变更
    if (!c && bf.charAt?.[cid] !== undefined) return true;
  }
  if (shot.sceneId) {
    const s = project.scenes.find((x) => x.id === shot.sceneId);
    const was = bf.sceneAt?.[shot.sceneId];
    if (s && was === undefined) return true; // P2：出图后补设的场景关联
    if (was !== undefined) {
      if (!s) return true; // 场景被删除
      if (was !== s.updatedAt) return true;
    }
  }
  return false;
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
