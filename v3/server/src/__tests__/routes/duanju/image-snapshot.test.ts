/**
 * 本地产物回流的上游态快照（设计共识 2026-11-26 第 3.5 节）：
 * 回流请求带 builtFromHint（multipart 文本字段，JSON 字符串）——帧的 builtFrom 用提示里的时刻，
 * 并记下本集剧本当时的更新时刻（没有记 0）；提示缺失或损坏按当前态。
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
  root = await mkdtemp(join(tmpdir(), 'v3-duanju-snap-'));
  process.env.DATA_DIR = root;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const png = Buffer.alloc(2048, 1);

/** 造一个已定稿、有 1 集（带剧本）与 1 个镜头的项目 */
async function seed(app: Express, withEpisodeScript: boolean): Promise<{ workId: string; shotId: string }> {
  const res = await authed(app).post('/api/works').send({ title: 't', mode: 'duanju', genre: 'x' });
  const workId = res.body.id as string;
  const p1 = await authed(app).patch(`/api/works/${workId}/duanju`).send({
    revision: 1,
    script: { source: 'pasted', text: '剧本原文', confirmed: true, updatedAt: 1 },
    episodes: [
      {
        id: 'ep1',
        index: 1,
        title: '第一集',
        synopsis: '梗概',
        ...(withEpisodeScript ? { script: '场1 内·地点·日\n正文', scriptSource: 'adapted', scriptUpdatedAt: 111 } : {}),
      },
    ],
  });
  const shotId = 'shot-x1';
  await authed(app).patch(`/api/works/${workId}/duanju`).send({
    revision: p1.body.revision,
    shots: [
      {
        id: shotId,
        episodeId: 'ep1',
        index: 1,
        shotSize: '中景',
        cameraMove: '固定',
        actionStart: '',
        actionEnd: '',
        staging: '',
        dialog: '',
        gridPrompt: 'p',
        characterIds: [],
        updatedAt: 1,
      },
    ],
  });
  return { workId, shotId };
}

function upload(app: Express, workId: string, shotId: string, hint?: string) {
  const req = authed(app)
    .post(`/api/works/${workId}/duanju/images/upload`)
    .field('kind', 'frame')
    .field('refId', shotId)
    .field('frameIndex', '1')
    .field('source', 'comfy')
    .field('prompt', 'p');
  if (hint !== undefined) req.field('builtFromHint', hint);
  return req.attach('file', png, { filename: 'a.png', contentType: 'image/png' });
}

async function builtFromOf(app: Express, workId: string): Promise<Record<string, unknown>> {
  const project = await authed(app).get(`/api/works/${workId}/duanju`);
  return project.body.shots[0].builtFrom as Record<string, unknown>;
}

describe('本地产物回流的快照', () => {
  it('带提示（JSON 字符串）：用提示里的时刻，并记下提示里的本集剧本时刻', async () => {
    const app = testApp();
    const { workId, shotId } = await seed(app, true);
    // 生成期间上游被改：剧本时间从 1 变成 999、本集剧本从 111 变成 222——快照要留住生成前态
    const cur = await authed(app).get(`/api/works/${workId}/duanju`);
    await authed(app).patch(`/api/works/${workId}/duanju`).send({
      revision: cur.body.revision,
      script: { ...cur.body.script, text: '改过的原文', updatedAt: 999 },
      episodes: [{ ...cur.body.episodes[0], script: '改过的本集', scriptUpdatedAt: 222 }],
    });
    const res = await upload(app, workId, shotId, JSON.stringify({ scriptAt: 1, charAt: {}, sceneAt: {}, episodeScriptAt: 111 }));
    expect(res.status).toBe(201);
    expect(await builtFromOf(app, workId)).toMatchObject({ scriptAt: 1, episodeScriptAt: 111 });
  });

  it('没带提示：按当前态记录（本集有剧本记其时刻，没有记 0）', async () => {
    const app = testApp();
    const withScript = await seed(app, true);
    expect((await upload(app, withScript.workId, withScript.shotId)).status).toBe(201);
    expect(await builtFromOf(app, withScript.workId)).toMatchObject({ scriptAt: 1, episodeScriptAt: 111 });

    const app2 = testApp();
    const withoutScript = await seed(app2, false);
    expect((await upload(app2, withoutScript.workId, withoutScript.shotId)).status).toBe(201);
    expect(await builtFromOf(app2, withoutScript.workId)).toMatchObject({ episodeScriptAt: 0 });
  });

  it('提示损坏或不是合法结构：按没有提示处理，不报错', async () => {
    const app = testApp();
    const { workId, shotId } = await seed(app, true);
    expect((await upload(app, workId, shotId, '{不是 json')).status).toBe(201);
    expect(await builtFromOf(app, workId)).toMatchObject({ scriptAt: 1, episodeScriptAt: 111 });
    const app2 = testApp();
    const seeded = await seed(app2, true);
    expect((await upload(app2, seeded.workId, seeded.shotId, JSON.stringify({ hack: true }))).status).toBe(201);
    expect(await builtFromOf(app2, seeded.workId)).toMatchObject({ episodeScriptAt: 111 });
  });
});
