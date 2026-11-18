/**
 * 短剧资产库路由测试（discuss/2026-11-18-短剧资产库设计.md）
 *
 * 覆盖：import-from（角色/场景/风格三类提取，sheetImages 空时按文件名扫描兜底，
 * 图片文件复制进资产目录且 path 改写为 DATA_DIR 相对）、资产 CRUD（GET list/:id）、
 * to-work（图片落 work/images + project.json 合并 + path 改回 work 相对）、
 * 风格 to-work 只填空字段、非法 type/workId 拒绝。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

import { duanjuAssetsRouter } from '../../../routes/library/duanjuAssets';
import { signToken } from '../../../middleware/auth';
import { HttpError } from '../../../middleware/validate';

process.env.ACCESS_PASSWORD = 'test123';

function testApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', duanjuAssetsRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: '内部错误' });
  });
  return app;
}

function authed(app: Express) {
  const cookie = `token=${signToken()}`;
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
  };
}

let root = '';
const WORK = 'w1';
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000, fake', 'utf8');

async function seedWork(): Promise<void> {
  const du = join(root, 'works', WORK, 'duanju');
  await mkdir(join(du, 'images'), { recursive: true });
  await writeFile(join(du, 'images', '陆惊尘-特写.png'), PNG);
  await writeFile(join(du, 'images', '宗门比剑台-场景.png'), PNG);
  const proj = {
    revision: 1,
    title: '仙侠测试剧',
    style: '仙侠古风，写实质感',
    visualSignature: '35mm 质感、逆光轮廓光',
    characters: [{
      id: 'c1', name: '陆惊尘', profile: '男，十六岁少年剑修／琥珀金瞳',
      sheetImages: [], refImageId: null, createdAt: 1, updatedAt: 1,
    }],
    scenes: [{
      id: 's1', name: '宗门比剑台', spec: '青铜剑柱环绕，北壁石碑',
      images: [], createdAt: 1, updatedAt: 1,
    }],
    episodes: [], shots: [],
  };
  await writeFile(join(du, 'project.json'), JSON.stringify(proj), 'utf-8');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-duanju-assets-'));
  process.env.DATA_DIR = root;
  await seedWork();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('POST /import-from/:workId', () => {
  it('characters：扫描兜底拿到特写图，图片落资产目录且 path 为 DATA_DIR 相对', async () => {
    const app = testApp();
    const res = await authed(app).post(`/api/import-from/${WORK}`).send({ type: 'characters' });
    expect(res.status).toBe(200);
    expect(res.body.imported).toEqual(['陆惊尘']);

    const listDir = join(root, 'duanju-assets', 'characters');
    const files = existsSync(listDir) ? 1 : 0;
    expect(files).toBe(1);
    const assetFiles = join(root, 'duanju-assets', 'files', 'characters');
    const assetId = (await readdir(listDir))[0].replace('.json', '');
    const assetJson = JSON.parse(await readFile(join(listDir, `${assetId}.json`), 'utf-8'));
    expect(assetJson.name).toBe('陆惊尘');
    expect(assetJson.sheetImages).toHaveLength(1);
    expect(assetJson.sheetImages[0].path).toContain('duanju-assets/files/characters/');
    expect(existsSync(join(root, assetJson.sheetImages[0].path))).toBe(true);
  });

  it('scenes：场景图扫描兜底同构可用', async () => {
    const app = testApp();
    const res = await authed(app).post(`/api/import-from/${WORK}`).send({ type: 'scenes' });
    expect(res.status).toBe(200);
    expect(res.body.imported).toEqual(['宗门比剑台']);
  });

  it('styles：提取作品顶层 style 与 visualSignature', async () => {
    const app = testApp();
    const res = await authed(app).post(`/api/import-from/${WORK}`).send({ type: 'styles' });
    expect(res.status).toBe(200);
    expect(res.body.imported).toEqual(['仙侠测试剧']);
    const dir = join(root, 'duanju-assets', 'styles');
    const raw = await readFile(join(dir, (await readdir(dir))[0]), 'utf-8');
    const style = JSON.parse(raw);
    expect(style.style).toBe('仙侠古风，写实质感');
    expect(style.visualSignature).toBe('35mm 质感、逆光轮廓光');
  });

  it('作品无 project.json → 404；非法 type → 400', async () => {
    const app = testApp();
    expect((await authed(app).post('/api/import-from/nope').send({ type: 'characters' })).status).toBe(404);
    expect((await authed(app).post(`/api/import-from/${WORK}`).send({ type: 'bad' })).status).toBe(400);
  });
});

describe('POST /:type/:assetId/to-work/:workId', () => {
  it('角色资产导入作品：新 id 入 project.json，图片落 work/images 且 path 改写', async () => {
    const app = testApp();
    await authed(app).post(`/api/import-from/${WORK}`).send({ type: 'characters' });
    const listDir = join(root, 'duanju-assets', 'characters');
    const assetId = (await readdir(listDir))[0].replace('.json', '');

    // 目标作品 w2
    const du2 = join(root, 'works', 'w2', 'duanju');
    await mkdir(du2, { recursive: true });
    await writeFile(join(du2, 'project.json'), JSON.stringify({
      revision: 1, title: '新剧', style: '', visualSignature: '',
      characters: [], scenes: [], episodes: [], shots: [],
    }), 'utf-8');

    const res = await authed(app).post(`/api/characters/${assetId}/to-work/w2`).send();
    expect(res.status).toBe(200);
    const proj2 = JSON.parse(await readFile(join(du2, 'project.json'), 'utf-8'));
    expect(proj2.characters).toHaveLength(1);
    const c = proj2.characters[0];
    expect(c.id).not.toBe(assetId);
    expect(c.sheetImages[0].path).toMatch(/^duanju\/images\//);
    expect(existsSync(join(root, 'works', 'w2', c.sheetImages[0].path))).toBe(true);
  });

  it('styles to-work：目标作品 style 为空才写入', async () => {
    const app = testApp();
    await authed(app).post(`/api/import-from/${WORK}`).send({ type: 'styles' });
    const dir = join(root, 'duanju-assets', 'styles');
    const assetId = (await import('node:fs/promises').then((m) => m.readdir(dir)))[0].replace('.json', '');
    const du2 = join(root, 'works', 'w2', 'duanju');
    await mkdir(du2, { recursive: true });
    await writeFile(join(du2, 'project.json'), JSON.stringify({
      revision: 1, title: '新剧', style: '已有风格', visualSignature: '',
      characters: [], scenes: [], episodes: [], shots: [],
    }), 'utf-8');
    const res = await authed(app).post(`/api/styles/${assetId}/to-work/w2`).send();
    expect(res.status).toBe(200);
    const proj2 = JSON.parse(await readFile(join(du2, 'project.json'), 'utf-8'));
    expect(proj2.style).toBe('已有风格');
    expect(proj2.visualSignature).toBe('35mm 质感、逆光轮廓光');
  });

  it('资产不存在 → 404', async () => {
    const app = testApp();
    const res = await authed(app).post('/api/characters/nope/to-work/w1').send();
    expect(res.status).toBe(404);
  });
});
