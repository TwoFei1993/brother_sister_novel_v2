/**
 * stale 推导（共识 D3：依赖提醒）：builtFrom 快照 vs 上游当前 updatedAt
 *
 * 纯函数：镜头有图（frames 或旧 gridImage）且任一上游（剧本/出场角色/场景）已变更 → 待刷新。
 * 「烧钱操作不自动跑」——stale 只标记，重生成一律手动。
 *
 * 帧级判定（P2 修复）：有 frameSnapshots 时逐帧比对——单帧重 roll 只刷自己的快照，
 * 其余帧基于旧上游的过时状态不再被洗白（缺快照的帧回退镜级 builtFrom 兜底）。
 *
 * 剧本这一项（设计共识 2026-11-26 第 3.5 节）——拆镜头读的是本集的分集剧本，所以：
 * - 快照记了本集剧本的时刻（不为 0）：只比本集时刻，不再比整本剧本的时间
 * - 快照为 0（出图时本集没有剧本）：本集现在有剧本 → 待刷新；否则比整本剧本时间（原规则）
 * - 旧快照没有这个字段：同上一条
 */
import type { BuiltFrom, DuanjuProject, DuanjuShot } from '@shared/duanju';

/** 本集剧本正文的当前更新时刻（没有分集剧本为 0） */
function episodeScriptAt(project: DuanjuProject, shot: DuanjuShot): number {
  return project.episodes.find((e) => e.id === shot.episodeId)?.scriptUpdatedAt ?? 0;
}

/** 剧本这一项是否变了 */
function scriptStale(bf: BuiltFrom, shot: DuanjuShot, project: DuanjuProject): boolean {
  const now = episodeScriptAt(project, shot);
  if (bf.episodeScriptAt !== undefined && bf.episodeScriptAt !== 0) return bf.episodeScriptAt !== now;
  if (now !== 0) return true; // 出图时本集还没有剧本，现在有了：依据变了
  return bf.scriptAt !== undefined && bf.scriptAt !== project.script.updatedAt;
}

/** 单份快照 vs 当前上游的比对（镜级与帧级共用） */
function snapshotStale(bf: BuiltFrom, shot: DuanjuShot, project: DuanjuProject): boolean {
  if (scriptStale(bf, shot, project)) return true;
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
  const frameSnaps = bf.frameSnapshots ?? {};
  if (Object.keys(frameSnaps).length > 0) {
    // 帧级：任一帧的独立快照与上游不一致 → 该镜有待刷新帧
    for (const snap of Object.values(frameSnaps)) {
      if (snap && snapshotStale(snap, shot, project)) return true;
    }
    // 每一帧都有自己的快照：以帧级为准（镜级快照停在首帧落地时，单帧重 roll 后不再代表任何一帧）
    const allFramesCovered = (shot.frames ?? []).length > 0 && (shot.frames ?? []).every((f) => frameSnaps[String(f.index)]);
    if (allFramesCovered) return false;
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
