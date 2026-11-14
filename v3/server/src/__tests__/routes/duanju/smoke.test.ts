/**
 * C4 短剧链路 API 冒烟（脱 LLM/脱 ComfyUI——CI 可跑）：
 * 建 duanju 作品 → 剧本定稿 → 角色/道具/集/镜头写入 → 帧图与道具图上传回流（comfy 记账路径）
 * → 导出 zip。聂小倩实拍（2026-11-14）与 C2/C3 新字段的回归化。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

import { worksRouter } from '../../../routes/works';
import { signToken } from '../../../middleware/auth';
import { HttpError } from '../../../middleware/validate';

process.env.ACCESS_PASSWORD = 'test123';

function testApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', worksRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  });
  return app;
}

function authed(app: Express) {
  const cookie = `token=${signToken()}`;
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
  };
}

const PNG_1KB = Buffer.alloc(1024, 0x89); // ≥1KB 过内容校验

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-duanju-smoke-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Ctx {
  app: Express;
  api: ReturnType<typeof authed>;
  workId: string;
  charId: string;
  propId: string;
  shotId: string;
  epId: string;
  rev: number;
}

async function setup(): Promise<Ctx> {
  const app = testApp();
  const api = authed(app);
  const created = await api.post('/api/works').send({ title: '冒烟', mode: 'duanju', genre: 'xuanhuan' });
  expect(created.status).toBe(201);
  const workId = created.body.id as string;

  const p1 = await api.get(`/api/works/${workId}/duanju`);
  expect(p1.status).toBe(200);
  const now = Date.now();
  const epId = 'ep-1';
  const charId = 'char-1';
  const propId = 'prop-1';
  const shotId = 'shot-1';
  const patched = await api.patch(`/api/works/${workId}/duanju`).send({
    revision: p1.body.revision as number,
    script: { source: 'pasted', text: '剧本', confirmed: true, updatedAt: now },
    episodes: [{ id: epId, index: 1, title: '一', synopsis: '梗概' }],
    characters: [{
      id: charId, name: '甲', profile: '黑发束冠，青衫',
      lockPhrase: 'black topknot, indigo robe', states: [{ fromEpisode: 1, note: '左手缠布条' }],
      sheetImages: [], refImageId: null, updatedAt: now,
    }],
    props: [{ id: propId, name: '旧怀表', spec: '黄铜壳裂纹', images: [], updatedAt: now }],
    shots: [{
      id: shotId, episodeId: epId, index: 1, shotSize: '近景', cameraMove: '固定',
      actionStart: '低头', actionEnd: '抬头', staging: '桌左', dialog: '谁在门外？', speaker: '甲',
      onScreenText: '门牌402', gridParts: ['a', 'b', 'c', 'd'], gridPrompt: 'p',
      propIds: [propId], durationSec: 5, frames: [], characterIds: [charId], sceneId: null, updatedAt: now,
    }],
  });
  if (patched.status !== 200) console.log('PATCH:', patched.status, String(patched.body?.error ?? '').slice(0, 300));
  expect(patched.status).toBe(200);
  return { app, api, workId, charId, propId, shotId, epId, rev: patched.body.revision };
}

describe('C4 短剧链路冒烟', () => {
  it('剧本定稿 + 全实体写入 + C2/C3 新字段落库回读', async () => {
    const c = await setup();
    const got = await c.api.get(`/api/works/${c.workId}/duanju`);
    expect(got.status).toBe(200);
    const shot = got.body.shots[0];
    expect(shot.speaker).toBe('甲');
    expect(shot.onScreenText).toBe('门牌402');
    expect(shot.propIds).toEqual([c.propId]);
    expect(shot.durationSec).toBe(5);
    expect(got.body.characters[0].lockPhrase).toContain('indigo');
    expect(got.body.characters[0].states).toHaveLength(1);
    expect(got.body.props[0].name).toBe('旧怀表');
  });

  it('C3 道具图上传回流：props[].images + spendLog 记账（本地免费豁免）', async () => {
    const c = await setup();
    const up = await c.api
      .post(`/api/works/${c.workId}/duanju/images/upload`)
      .field('kind', 'prop')
      .field('refId', c.propId)
      .field('source', 'comfy')
      .field('prompt', '道具定妆图')
      .attach('file', PNG_1KB, { filename: 'prop.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    expect(up.body.image.path).toMatch(/^duanju\/images\//);
    const proj = up.body.project;
    expect(proj.props[0].images).toHaveLength(1);
    expect(proj.spendLog.at(-1).kind).toBe('prop');
    expect(proj.spendLog.at(-1).note).toContain('本地免费');
  });

  it('帧上传回流（comfy）：frames 挂帧 + rolls=0 + 版本 +1', async () => {
    const c = await setup();
    const up = await c.api
      .post(`/api/works/${c.workId}/duanju/images/upload`)
      .field('kind', 'frame')
      .field('refId', c.shotId)
      .field('frameIndex', '2')
      .field('source', 'comfy')
      .field('prompt', '第2帧')
      .attach('file', PNG_1KB, { filename: 'f2.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    const shot = up.body.project.shots[0];
    expect(shot.frames).toHaveLength(1);
    expect(shot.frames[0].index).toBe(2);
    expect(shot.frames[0].rolls).toBe(0);
    expect(up.body.project.revision).toBe(c.rev + 1);
  });

  it('导出 zip：200 + content-type（有帧镜头）', async () => {
    const c = await setup();
    await c.api
      .post(`/api/works/${c.workId}/duanju/images/upload`)
      .field('kind', 'frame').field('refId', c.shotId).field('frameIndex', '1')
      .field('source', 'comfy').field('prompt', 'f1')
      .attach('file', PNG_1KB, { filename: 'f1.png', contentType: 'image/png' });
    const zip = await c.api.get(`/api/works/${c.workId}/duanju/export/${c.epId}`);
    expect(zip.status).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
  });

  it('404 语义：道具不存在上传 → 404 且无 image 返回（文件回滚）', async () => {
    const c = await setup();
    const up = await c.api
      .post(`/api/works/${c.workId}/duanju/images/upload`)
      .field('kind', 'prop').field('refId', 'prop-ghost')
      .field('source', 'comfy').field('prompt', 'x')
      .attach('file', PNG_1KB, { filename: 'g.png', contentType: 'image/png' });
    expect(up.status).toBe(404);
    expect(up.body.image).toBeUndefined();
  });
});
