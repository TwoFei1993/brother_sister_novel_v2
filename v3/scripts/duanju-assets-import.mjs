// 短剧资产库迁移脚本：把指定作品的 characters/scenes/styles 提取进 data/duanju-assets/
// 用法：node scripts/duanju-assets-import.mjs <workId>
// 逻辑与 server import-from 同构（路由版有 vitest 覆盖；本脚本用于无 server 环境的一次性迁移）。
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const DATA = resolve(process.cwd(), 'data');
const workId = process.argv[2];
if (!workId) {
  console.error('用法: node scripts/duanju-assets-import.mjs <workId>');
  process.exit(1);
}

const now = Date.now();
const du = join(DATA, 'works', workId, 'duanju');
const proj = JSON.parse(await readFile(join(du, 'project.json'), 'utf-8'));

async function copyInto(type, assetId, img) {
  const src = resolve(join(DATA, 'works', workId), img.path);
  const dstDir = join(DATA, 'duanju-assets', 'files', type, assetId);
  await mkdir(dstDir, { recursive: true });
  const fname = `${img.id}${basename(img.path).match(/\.[a-z0-9]+$/i)?.[0] ?? '.png'}`;
  await copyFile(src, join(dstDir, fname));
  return { ...img, path: `duanju-assets/files/${type}/${assetId}/${fname}` };
}

async function scanImages(name, kind) {
  let files = [];
  try { files = await readdir(join(du, 'images')); } catch { return []; }
  return files
    .filter((f) => f.startsWith(`${name}-${kind}`) && /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => ({ id: randomUUID(), path: `duanju/images/${f}`, prompt: '迁移扫描', createdAt: now }));
}

const report = { characters: [], scenes: [], styles: [] };

for (const c of proj.characters ?? []) {
  const assetId = randomUUID();
  let imgs = c.sheetImages ?? [];
  if (imgs.length === 0) imgs = await scanImages(c.name, '特写');
  const sheet = [];
  for (const img of imgs) { try { sheet.push(await copyInto('characters', assetId, img)); } catch {} }
  const asset = { ...c, id: assetId, sheetImages: sheet, refImageId: sheet[0]?.id ?? null, tags: [], sourceWorkId: workId, createdAt: c.createdAt ?? now, updatedAt: now };
  const dir = join(DATA, 'duanju-assets', 'characters');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${assetId}.json`), JSON.stringify(asset, null, 1), 'utf-8');
  report.characters.push(`${c.name}（图 ${sheet.length} 张）`);
}

for (const s of proj.scenes ?? []) {
  const assetId = randomUUID();
  let imgs = s.images ?? [];
  if (imgs.length === 0) imgs = await scanImages(s.name, '场景');
  const sceneImgs = [];
  for (const img of imgs) { try { sceneImgs.push(await copyInto('scenes', assetId, img)); } catch {} }
  const asset = { ...s, id: assetId, images: sceneImgs, tags: [], sourceWorkId: workId, createdAt: s.createdAt ?? now, updatedAt: now };
  const dir = join(DATA, 'duanju-assets', 'scenes');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${assetId}.json`), JSON.stringify(asset, null, 1), 'utf-8');
  report.scenes.push(`${s.name}（图 ${sceneImgs.length} 张）`);
}

{
  const name = String(proj.title ?? workId).replace(/[\\/:*?"<>|\s]+/g, '') || workId;
  const asset = {
    id: randomUUID(), name,
    style: String(proj.style ?? ''), visualSignature: String(proj.visualSignature ?? ''),
    tags: [], sourceWorkId: workId, createdAt: now, updatedAt: now,
  };
  const dir = join(DATA, 'duanju-assets', 'styles');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${asset.id}.json`), JSON.stringify(asset, null, 1), 'utf-8');
  report.styles.push(name);
}

console.log('迁移完成:', JSON.stringify(report, null, 1));
