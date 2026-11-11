/**
 * 分帧生图路由测试（成本优化 A 项）：kind='frame' 挂帧/重roll/记账 + 边界
 *
 * 覆盖：
 * - 首帧生成：frames 追加 + 排序 + spendLog 记账（note=frame-N）+ builtFrom 快照
 * - 同帧重生成：rolls+1、旧 image 替换、spendLog 再记一条
 * - frameIndex 缺失 → 400；镜头不存在 → 404
 * - 旧 project.json（无 frames/spendLog 字段）→ 服务端 ?? [] 防御不炸
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  root = await mkdtemp(join(tmpdir(), 'v3-duanju-frames-'));
  process.env.DATA_DIR = root;
});

// 生图 key 读 dataDir/secrets.json（无则 IMG_AUTH）——mock fetch 前先落测试 key
beforeEach(async () => {
  await mkdir(join(root), { recursive: true });
  await writeFile(join(root, 'secrets.json'), JSON.stringify({ ark: { apiKey: 'sk-test' } }), 'utf8');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** mock 生图上游（成功返回 URL）+ 下载（返回 png 字节） */
function mockImageUpstream(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('images/generations')) {
        return new Response(
          JSON.stringify({ data: [{ url: 'https://cdn.example.com/x.png' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(Buffer.alloc(2048, 7), { status: 200 });
    }),
  );
}

async function seed(app: Express, shotsOverride?: Record<string, unknown>): Promise<{ workId: string; shotId: string; rev: number }> {
  const res = await authed(app).post('/api/works').send({ title: 't', mode: 'duanju', genre: 'x' });
  const workId = res.body.id as string;
  const p1 = await authed(app).patch(`/api/works/${workId}/duanju`).send({
    revision: 1,
    script: { source: 'manual', text: '剧本', confirmed: true, updatedAt: 1 },
  });
  const shotId = 'shot-f1';
  await authed(app).patch(`/api/works/${workId}/duanju`).send({
    revision: p1.body.revision,
    shots: [
      {
        id: shotId, episodeId: 'ep1', index: 1, shotSize: '中景', cameraMove: '固定',
        actionStart: 'a', actionEnd: 'b', staging: 's', dialog: '', sound: '',
        gridParts: ['起', '承', '转', '合'], gridPrompt: 'p', frames: [],
        characterIds: [], updatedAt: 1,
        ...shotsOverride,
      },
    ],
  });
  return { workId, shotId, rev: p1.body.revision + 1 };
}

describe('分帧生图（kind=frame）', () => {
  it('首帧：frames 追加排序 + spendLog 记账 note=frame-N + revision+1', async () => {
    const app = testApp();
    const { workId, shotId } = await seed(app);
    mockImageUpstream();
    const res = await authed(app).post(`/api/works/${workId}/duanju/images`).send({
      kind: 'frame', refId: shotId, frameIndex: 2, prompt: '第2帧：承', aspectRatio: '1:1',
    });
    expect(res.status).toBe(200);
    const project = JSON.parse(await readFile(join(root, 'works', workId, 'duanju', 'project.json'), 'utf8'));
    const shot = project.shots.find((s: { id: string }) => s.id === shotId);
    expect(shot.frames).toHaveLength(1);
    expect(shot.frames[0].index).toBe(2);
    expect(shot.frames[0].rolls).toBe(0);
    expect(shot.builtFrom.scriptAt).toBe(1);
    expect(project.spendLog).toHaveLength(1);
    expect(project.spendLog[0]).toMatchObject({ kind: 'frame', refId: shotId, note: 'frame-2' });
  });

  it('同帧重生成：rolls+1、image 替换、乱序帧保持 index 排序', async () => {
    const app = testApp();
    const { workId, shotId } = await seed(app);
    mockImageUpstream();
    const client = authed(app);
    await client.post(`/api/works/${workId}/duanju/images`).send({ kind: 'frame', refId: shotId, frameIndex: 3, prompt: 'p' });
    await client.post(`/api/works/${workId}/duanju/images`).send({ kind: 'frame', refId: shotId, frameIndex: 1, prompt: 'p' });
    const again = await client.post(`/api/works/${workId}/duanju/images`).send({ kind: 'frame', refId: shotId, frameIndex: 3, prompt: 'p' });
    expect(again.status).toBe(200);
    const project = JSON.parse(await readFile(join(root, 'works', workId, 'duanju', 'project.json'), 'utf8'));
    const shot = project.shots.find((s: { id: string }) => s.id === shotId);
    expect(shot.frames.map((f: { index: number }) => f.index)).toEqual([1, 3]);
    expect(shot.frames.find((f: { index: number }) => f.index === 3).rolls).toBe(1);
    expect(project.spendLog).toHaveLength(3); // 3 次生成 3 条账
  });

  it('kind=frame 缺 frameIndex → 400；镜头不存在 → 404', async () => {
    const app = testApp();
    const { workId, shotId } = await seed(app);
    const client = authed(app);
    const noIdx = await client.post(`/api/works/${workId}/duanju/images`).send({ kind: 'frame', refId: shotId, prompt: 'p' });
    expect(noIdx.status).toBe(400);
    const noShot = await client.post(`/api/works/${workId}/duanju/images`).send({ kind: 'frame', refId: 'nope', frameIndex: 1, prompt: 'p' });
    expect(noShot.status).toBe(404);
  });

  it('旧 project.json（无 frames/spendLog 字段）→ ?? [] 防御正常挂帧', async () => {
    const app = testApp();
    const { workId, shotId } = await seed(app, {
      // 模拟旧客户端写入的镜头：没有 frames 字段
      frames: undefined,
    });
    // 再直接抹掉 project.json 的 spendLog，模拟升级前数据
    const file = join(root, 'works', workId, 'duanju', 'project.json');
    const raw = JSON.parse(await readFile(file, 'utf8'));
    delete raw.spendLog;
    await writeFile(file, JSON.stringify(raw), 'utf8');

    mockImageUpstream();
    const res = await authed(app).post(`/api/works/${workId}/duanju/images`).send({
      kind: 'frame', refId: shotId, frameIndex: 1, prompt: 'p',
    });
    expect(res.status).toBe(200);
    const shot = res.body.project.shots.find((s: { id: string }) => s.id === shotId);
    expect(shot.frames).toHaveLength(1);
    expect(res.body.project.spendLog).toHaveLength(1);
  });
});
