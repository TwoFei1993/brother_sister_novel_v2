/**
 * 聂小倩 EP1 实测 · 媒体段：设定图（锚点特写+正面全身）→ 场景图 → 拆镜头 → 分镜帧（2511）→ H3 视频 → merge
 *
 * node 驱动差异说明：设定图跳过 canvas 版式合成（comfyCompose 浏览器专属）——
 * 锚点特写/正面全身两条核心归档路径与 App 完全一致；帧/视频/成片走全真实链路。
 */
import { readFileSync, writeFileSync } from 'node:fs';

import './nie-lib';
import { login } from './nie-lib';
import {
  generateDuanjuImage,
  getDuanjuProject,
  patchDuanjuProject,
  uploadDuanjuImageFile,
  uploadDuanjuVideo,
  duanjuFileUrl,
} from '../../client/src/api/duanju';
import {
  generateImageOnComfy,
  loadComfyConfig,
  submitVideoOnComfy,
  pollVideoOnComfy,
} from '../../client/src/features/duanju/lib/comfy';
import { anchorPortraitPrompt } from '../../client/src/features/duanju/lib/prompts/prompts-image';
import { sceneImagePrompt } from '../../client/src/features/duanju/lib/prompts/prompts-scene';
import {
  buildStoryboardMessages,
  parseStoryboard,
  validateStoryboardIssues,
  buildFramePrompt,
  frameRefImage,
  frameBodyRefImage,
  frameSceneImage,
} from '../../client/src/features/duanju/lib/prompts/prompts-storyboard';
import { buildLocalVideoPrompt } from '../../client/src/features/duanju/lib/prompts/prompts-video';
import { llmText } from './nie-lib';
import type { DuanjuProject } from '@shared/duanju';

const seed = (): number => Math.floor(Math.random() * 2_147_483_647);

async function fetchBlob(path: string): Promise<Blob> {
  const r = await fetch(duanjuFileUrl(WORK_ID, path));
  if (!r.ok) throw new Error(`取图失败 ${path}: ${r.status}`);
  return r.blob();
}

let WORK_ID = '';

/** 锚点特写（2511 image1·锁脸）+ 正面全身（image2·锁身体）——App 设定图的两条核心归档 */
async function characterRefs(project: DuanjuProject): Promise<DuanjuProject> {
  const cfg = loadComfyConfig();
  for (const c of project.characters) {
    if (c.sheetImages.length > 0) {
      console.log(`  [char] ${c.name} 已有设定图，跳过`);
      continue;
    }
    const frontPrompt = `${project.style}，角色正面全身定妆照：${c.name}（${c.profile}），正面站姿，白底干净背景，全身入画，无文字水印`;
    console.log(`  [char] ${c.name} 特写+全身 ...`);
    const [portraitBlob, frontBlob] = await Promise.all([
      generateImageOnComfy(cfg, { prompt: anchorPortraitPrompt(project.style, c.name, c.profile), width: 704, height: 1024, seed: seed() }),
      generateImageOnComfy(cfg, { prompt: frontPrompt, width: 896, height: 1280, seed: seed() }),
    ]);
    const cur0 = await getDuanjuProject(WORK_ID);
    const ch0 = cur0.characters.find((x) => x.id === c.id)!;
    const pFile = new File([portraitBlob], 'portrait.png', { type: 'image/png' });
    const { image: pImg, project: after1 } = await uploadDuanjuImageFile(WORK_ID, 'character', c.id, pFile, { prompt: frontPrompt, source: 'comfy' });
    const fFile = new File([frontBlob], 'front.png', { type: 'image/png' });
    const { project: after2 } = await uploadDuanjuImageFile(WORK_ID, 'character', c.id, fFile, { prompt: `【正面全身】${frontPrompt}`, source: 'comfy' });
    void ch0;
    const characters = after2.characters.map((x) => (x.id === c.id ? { ...x, refImageId: pImg.id } : x));
    project = await patchDuanjuProject(WORK_ID, { revision: after2.revision, characters });
    console.log(`  [char] ${c.name} ✓（ref=${pImg.id}）`);
  }
  return project;
}

async function sceneImages(project: DuanjuProject): Promise<DuanjuProject> {
  const cfg = loadComfyConfig();
  for (const s of project.scenes) {
    if (s.images.length > 0) {
      console.log(`  [scene] ${s.name} 已有图，跳过`);
      continue;
    }
    console.log(`  [scene] ${s.name} ...`);
    const blob = await generateImageOnComfy(cfg, {
      prompt: sceneImagePrompt(project.style, s.name, s.spec),
      width: 1344, height: 768, seed: seed(),
    });
    const cur = await getDuanjuProject(WORK_ID);
    const file = new File([blob], 'scene.png', { type: 'image/png' });
    const { project: after } = await uploadDuanjuImageFile(WORK_ID, 'scene', s.id, file, { prompt: s.spec, source: 'comfy' });
    project = after;
    console.log(`  [scene] ${s.name} ✓`);
  }
  return project;
}

async function main(): Promise<void> {
  await login();
  WORK_ID = JSON.parse(readFileSync('scripts-e2e/nie-state.json', 'utf-8')).workId as string;
  console.log('[media] work:', WORK_ID);

  let project = await getDuanjuProject(WORK_ID);
  const ep1 = project.episodes.find((e) => e.index === 1);
  if (!ep1) throw new Error('EP1 不存在');

  // ① 设定图（5 角色全量）
  console.log('[1] 角色设定图');
  project = await characterRefs(project);

  // ② 场景图
  console.log('[2] 场景图');
  project = await sceneImages(project);

  // ③ 拆镜头 EP1（幂等：已有镜头跳过）
  if (project.shots.some((s) => s.episodeId === ep1.id)) {
    console.log('[3] EP1 已有镜头，跳过拆镜头');
  } else {
  console.log('[3] LLM 拆镜头 EP1');
  const raw = await llmText(
    buildStoryboardMessages(`${ep1.title}：${ep1.synopsis}`, project.script.text, project.characters, project.scenes, project.props),
  );
  let shots = parseStoryboard(raw, ep1.id, project);
  if (shots.length === 0) throw new Error('拆镜头解析失败');
  const issues = validateStoryboardIssues(shots);
  if (issues.length > 0) console.log('  [warn] 机检:\n   ' + issues.join('\n   '));
  const others = project.shots.filter((s) => s.episodeId !== ep1.id);
  project = await patchDuanjuProject(WORK_ID, { revision: project.revision, shots: [...others, ...shots] });
  console.log(`  镜头数: ${shots.length}，时长: ${shots.map((s) => s.durationSec ?? 5).join('+')}s`);
  }

  // ④ 分镜帧（2511 三参考）——EP1 全部镜头 ×4 帧
  console.log('[4] 分镜帧生成（2511）');
  const fresh = await getDuanjuProject(WORK_ID);
  const ep1Shots = fresh.shots.filter((s) => s.episodeId === ep1.id).sort((a, b) => a.index - b.index);
  // 2026-11-14 降级：RAM 仅 7.7G（他项目占 24G），2511 20G 模型装不下——帧退 Z-Image（lockPhrase 文字锚点兜底）
  for (const shot of ep1Shots) {
    for (const i of [1, 2, 3, 4]) {
      if (shot.frames?.some((f) => f.index === i)) continue;
      const prompt = buildFramePrompt(shot, i, fresh, {});
      console.log(`  [frame] S${shot.index} F${i} ...`);
      const { project: after } = await generateDuanjuImage(WORK_ID, {
        kind: 'frame', refId: shot.id, frameIndex: i, prompt, provider: 'comfy', aspectRatio: '9:16',
      });
      void after;
    }
    console.log(`  [frame] S${shot.index} ✓ 4帧`);
  }  }

  // ⑤ H3 视频：挑 EP1 前 3 镜（时长控制在 ~30 分钟）
  console.log('[5] H3 视频（前 3 镜 flf2v）');
  const cfg = loadComfyConfig();
  const videoShots = (await getDuanjuProject(WORK_ID)).shots
    .filter((s) => s.episodeId === ep1.id)
    .sort((a, b) => a.index - b.index)
    .slice(0, 2);
  for (const shot of videoShots) {
    const projNow = await getDuanjuProject(WORK_ID);
    const freshShot = projNow.shots.find((s) => s.id === shot.id)!;
    const paths = [1, 2, 3, 4].map((i) => freshShot.frames.find((f) => f.index === i)?.image.path).filter((p): p is string => !!p);
    if (paths.length < 2) { console.log(`  [video] S${shot.index} 帧不足，跳过`); continue; }
    const firstBlob = await fetchBlob(paths[0]!);
    const lastBlob = await fetchBlob(paths[paths.length - 1]!);
    const chars = freshShot.characterIds
      .map((cid) => projNow.characters.find((c) => c.id === cid))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({ name: c.name, profile: c.profile, lockPhrase: c.lockPhrase }))
    const prompt = buildLocalVideoPrompt(freshShot, chars, { hasLastFrame: true });
    const duration = Math.min(freshShot.durationSec ?? 5, 5); // 12GB 安全档：每镜 ≤5s
    console.log(`  [video] S${shot.index} ${duration}s flf2v ...`);
    const t0 = Date.now();
    const task = await submitVideoOnComfy(cfg, firstBlob, prompt, duration, { lastFrameBlob: lastBlob });
    const { blob } = await pollVideoOnComfy(task, (p) => {
      if (p.elapsedSec % 60 < 3) console.log(`    … ${p.phase} ${p.elapsedSec}s`);
    });
    const file = new File([blob], `S${shot.index}-local.mp4`, { type: 'video/mp4' });
    await uploadDuanjuVideo(WORK_ID, shot.id, file);
    console.log(`  [video] S${shot.index} ✓ ${Math.round((Date.now() - t0) / 1000)}s`);
  }

  // ⑥ 成片
  console.log('[6] merge 成片');
  const mr = await fetch(`/api/works/${WORK_ID}/duanju/merge/${ep1.id}`, { method: 'POST' });
  const mj = (await mr.json().catch(() => ({}))) as { url?: string; error?: string };
  console.log('[merge]', mr.status, mj.url ?? mj.error ?? '');

  writeFileSync('scripts-e2e/nie-done.json', JSON.stringify({ workId: WORK_ID, merged: mj.url ?? null }, null, 1), 'utf-8');
  console.log('[ALL DONE]');
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
