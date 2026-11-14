/**
 * 成品视频回传测试（实施计划 T4.1）：multipart 上传 → finalVideo 落库 + 校验
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
  };
}

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-duanju-vid-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 造一个带 shots 的短剧项目，返回 {workId, shotId} */
async function seed(app: Express): Promise<{ workId: string; shotId: string }> {
  const res = await authed(app).post('/api/works').send({ title: 't', mode: 'duanju', genre: 'x' });
  const workId = res.body.id as string;
  const p1 = await authed(app).patch(`/api/works/${workId}/duanju`).send({
    revision: 1,
    script: { source: 'manual', text: '剧本', confirmed: true, updatedAt: 1 },
  });
  const shotId = 'shot-x1';
  await authed(app).patch(`/api/works/${workId}/duanju`).send({
    revision: p1.body.revision,
    shots: [{
      id: shotId, episodeId: 'ep1', index: 1, shotSize: '中景', cameraMove: '固定',
      actionStart: '', actionEnd: '', staging: '', dialog: '', gridPrompt: 'p',
      characterIds: [], updatedAt: 1,
    }],
  });
  return { workId, shotId };
}

const mp4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), // ftyp box
  Buffer.alloc(2048, 1), // 撑过最小体积校验
]);

describe('duanju 成品视频回传', () => {
  it('mp4 上传 → finalVideo 落库 + 文件落盘 videos/ + files 路由可读', async () => {
    const app = testApp();
    const { workId, shotId } = await seed(app);
    const res = await authed(app)
      .post(`/api/works/${workId}/duanju/videos`)
      .field('shotId', shotId)
      .attach('file', mp4, { filename: 'final.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(201);
    const path = res.body.path as string;
    expect(path).toMatch(/^duanju\/videos\/[\w-]+\.mp4$/);
    expect(existsSync(join(root, 'works', workId, path))).toBe(true);

    const project = await authed(app).get(`/api/works/${workId}/duanju`);
    const shot = project.body.shots.find((s: { id: string }) => s.id === shotId);
    expect(shot.finalVideo.path).toBe(path);

    const file = await authed(app).get(`/api/works/${workId}/duanju/files/${path.split('/').pop()}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('video/mp4');
    expect(file.body.length).toBe(mp4.length);
  });

  it('Range 请求 → 206 分段（连播拖动）', async () => {
    const app = testApp();
    const { workId, shotId } = await seed(app);
    const up = await authed(app)
      .post(`/api/works/${workId}/duanju/videos`)
      .field('shotId', shotId)
      .attach('file', mp4, { filename: 'a.mp4', contentType: 'video/mp4' });
    const name = (up.body.path as string).split('/').pop()!;
    // 只断言状态与响应头（流式 pipe 的 body 读取与 supertest 冲突；播放由浏览器实测）
    await authed(app)
      .get(`/api/works/${workId}/duanju/files/${name}`)
      .set('Range', 'bytes=0-99')
      .expect(206)
      .expect('Content-Range', /^bytes 0-99\//)
      .expect('Accept-Ranges', 'bytes');
  });

  it('类型不支持 → 400；shotId 不存在 → 404；未登录 → 401', async () => {
    const app = testApp();
    const { workId, shotId } = await seed(app);
    const bad = await authed(app)
      .post(`/api/works/${workId}/duanju/videos`)
      .field('shotId', shotId)
      .attach('file', Buffer.from('x'.repeat(2048)), { filename: 'a.gif', contentType: 'image/gif' });
    expect(bad.status).toBe(400);

    const noShot = await authed(app)
      .post(`/api/works/${workId}/duanju/videos`)
      .field('shotId', 'ghost')
      .attach('file', mp4, { filename: 'a.mp4', contentType: 'video/mp4' });
    expect(noShot.status).toBe(404);

    expect(
      (await request(app).post(`/api/works/${workId}/duanju/videos`)).status,
    ).toBe(401);
  });
});
