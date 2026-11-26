/**
 * 提取结果并入角色 / 场景表（流水线的角色、场景两步，设计共识 2026-11-26 第 3.6 节「已有内容不覆盖」）：
 * 已有且档案非空的不动（不改内容、不更新时刻——此前会覆盖用户手调过的档案，并让已出图的镜头全部待刷新）；
 * 档案为空的补上；新名字追加。
 */
import type { DuanjuCharacter, DuanjuEpisode, DuanjuScene, EpisodeScriptSource } from '@shared/duanju';

import type { ExtractedCharacter } from '../characterExtract';
import type { ExtractedScene } from '../sceneExtract';

/**
 * 把剧本正文写进某一集（展开保留该集的其余字段：叙事机制、锚点等——重建对象会把它们丢掉）。
 * 传入空白等于清除本集剧本。
 */
export function withEpisodeScript(
  episodes: readonly DuanjuEpisode[],
  episodeId: string,
  script: string,
  source: EpisodeScriptSource,
  now: number,
): DuanjuEpisode[] {
  return episodes.map((e) => {
    if (e.id !== episodeId) return e;
    const text = script.trim();
    return text
      ? { ...e, script, scriptSource: source, scriptUpdatedAt: now }
      : { ...e, script: undefined, scriptSource: undefined, scriptUpdatedAt: now };
  });
}

export function mergeExtractedCharacters(
  cur: readonly DuanjuCharacter[],
  list: readonly ExtractedCharacter[],
  now: number,
): DuanjuCharacter[] {
  const merged = [...cur];
  for (const c of list) {
    const idx = merged.findIndex((x) => x.name === c.name);
    if (idx >= 0) {
      if (merged[idx]!.profile.trim() || !c.profile.trim()) continue; // 已有档案不覆盖
      merged[idx] = { ...merged[idx]!, profile: c.profile, updatedAt: now };
    } else {
      merged.push({
        id: `char-${now}-${Math.random().toString(36).slice(2, 6)}`,
        name: c.name,
        profile: c.profile,
        sheetImages: [],
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return merged;
}

export function mergeExtractedScenes(
  cur: readonly DuanjuScene[],
  list: readonly ExtractedScene[],
  now: number,
): DuanjuScene[] {
  const merged = [...cur];
  for (const s of list) {
    const idx = merged.findIndex((x) => x.name === s.name);
    if (idx >= 0) {
      if (merged[idx]!.spec.trim() || !s.spec.trim()) continue;
      merged[idx] = { ...merged[idx]!, spec: s.spec, updatedAt: now };
    } else {
      merged.push({
        id: `scene-${now}-${Math.random().toString(36).slice(2, 6)}`,
        name: s.name,
        spec: s.spec,
        images: [],
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return merged;
}
