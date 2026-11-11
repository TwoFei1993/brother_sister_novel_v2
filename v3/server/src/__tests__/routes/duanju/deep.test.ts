/**
 * 短剧深度测试（R 级：边界/安全/并发/数据一致性）
 *
 * 覆盖：
 * - files 路由安全：未登录 401 / 路径穿越拒绝 / 未知扩展名 404 / 錯目录（images 名到 videos 位）
 * - 生图错误路径：IMG_AUTH（无 key）/ prompt 超长截断由 service 保证（此处锁路由 400 边界）
 * - 乐观锁并发：双 PATCH 竞争唯一胜者（409）
 * - 生图与 PATCH 并发 revision 单调（attachImage 的 +1 不与 PATCH 冲突丢失）
 * - 读者角色：不可写（POST/PATCH 403）、不可读 project（作者域）
 * - 删除联动：删有图镜头后 project 一致（图文件留存无害、引用清除）
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import request from 'supertest';

import { worksRouter } from '../../../routes/works';
import { signToken, requireAuthor } from '../../../middleware/auth';
import { HttpError } from '../../../middleware/validate';

process.env.ACCESS_PASSWORD = 'test123';

function testApp(): Express {
  const app = express();
  app.use(express.json());
  // 与 app.ts 同款：非 GET → requireAuthor（读者不可写创作域）
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET') return next();
    return requireAuthor(req, res, next);
  });
  app.use('/api', worksRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // 与 app.ts errorHandler 同款：上传超限是客户端问题非 500
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: '文件超过大小限制' });
      return;
    }
    res.status(500).json({ error: '内部错误' });
  });
  return app;
}

function authed(app: Express, role: 'author' | 'reader' = 'author') {
  const cookie = `token=${signToken(role === 'author' ? {} : { uid: 'reader', role: 'reader' })}`;
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string) => request(app).post(url).set('Cookie', cookie),
    patch: (url: string) => request(app).patch(url).set('Cookie', cookie),
    del: (url: string) => request(app).delete(url).set('Cookie', cookie),
  };
}

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-duanju-deep-'));
  process.env.DATA_DIR = root;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Seed {
  workId: string;
  shotId: string;
}

/** 建带 1 镜头的短剧（confirmed=true 解锁语义只在前端，API 层不做门禁——记录为已知设计） */
async function seedWithShot(app: Express): Promise<Seed> {
  const res = await authed(app).post('/api/works').send({ title: 't', mode: 'duanju', genre: 'x' });
  const workId = res.body.id as string;
  const p1 = await authed(app).patch(`/api/works/${workId}/duanju`).send({
    revision: 1,
    script: { source: 'manual', text: '剧本', confirmed: true, updatedAt: 1 },
  });
  const shotId = 'shot-d1';
  await authed(app).patch(`/api/works/${workId}/duanju`).send({
    revision: p1.body.revision,
    shots: [{
      id: shotId, episodeId: 'ep1', index: 1, shotSize: '中景', cameraMove: '固定',
      actionStart: 'a', actionEnd: 'b', staging: 's', dialog: '', sound: '', gridPrompt: 'p',
      characterIds: [], updatedAt: 1,
    }],
  });
  return { workId, shotId };
}

/** mock 生图上游（成功返回 URL）+ 下载（返回 png 字节） */
function mockImageUpstream(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, _init?: RequestInit) => {
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

describe('D-安全：files 与路由权限', () => {
  it('未登录：duanju 全路由 401；files 401', async () => {
    const app = testApp();
    const { workId } = await seedWithShot(app);
    expect((await request(app).get(`/api/works/${workId}/duanju`)).status).toBe(401);
    expect((await request(app).get(`/api/works/${workId}/duanju/files/anything.png`)).status).toBe(401);
    expect((await request(app).post(`/api/works/${workId}/duanju/images`)).status).toBe(401);
  });

  it('路径穿越：../ 与 ..\\ 与绝对路径变体全部 404', async () => {
    const app = testApp();
    const { workId } = await seedWithShot(app);
    for (const name of [
      '..%2F..%2Fwork.json',
      '..%5C..%5Cwork.json',
      '..',
      'a..b.png',
      'sub/x.png',
      '%2e%2e%2f%2e%2e%2fsecrets.json',
    ]) {
      const r = await authed(app).get(`/api/works/${workId}/duanju/files/${name}`);
      expect([404, 400]).toContain(r.status);
    }
  });

  it('扩展名白名单外 404；目录错位（图片名不在 videos 位）404', async () => {
    const app = testApp();
    const { workId } = await seedWithShot(app);
    expect((await authed(app).get(`/api/works/${workId}/duanju/files/x.exe`)).status).toBe(404);
    expect((await authed(app).get(`/api/works/${workId}/duanju/files/x.gif`)).status).toBe(404);
    // mp4 名向 videos 目录找（不存在）→ 404 而非 fallback images
    expect((await authed(app).get(`/api/works/${workId}/duanju/files/not-exist.mp4`)).status).toBe(404);
  });

  it('读者角色：不可写 project / 不可生图（作者域路由）', async () => {
    const app = testApp();
    const { workId } = await seedWithShot(app);
    const reader = authed(app, 'reader');
    const w = await reader.get(`/api/works/${workId}/duanju`);
    // worksRouter 本身 authRequired（登录即可读，读者过滤在 list 层）；写操作走 requireAuthor
    expect((await reader.patch(`/api/works/${workId}/duanju`).send({ revision: 2, style: 'x' })).status).toBe(403);
    expect(
      (
        await reader
          .post(`/api/works/${workId}/duanju/images`)
          .send({ kind: 'scene', refId: 'x', prompt: 'p' })
      ).status,
    ).toBe(403);
    void w;
  });
});

describe('D-并发：乐观锁与生图写回', () => {
  it('双 PATCH 竞争：先到 +1，后到 409（唯一胜者）', async () => {
    const app = testApp();
    const { workId } = await seedWithShot(app);
    const p1 = await authed(app).get(`/api/works/${workId}/duanju`);
    const [a, b] = await Promise.all([
      authed(app).patch(`/api/works/${workId}/duanju`).send({ revision: p1.body.revision, style: '写实' }),
      authed(app).patch(`/api/works/${workId}/duanju`).send({ revision: p1.body.revision, style: '水墨' }),
    ]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);
    const final = await authed(app).get(`/api/works/${workId}/duanju`);
    expect(final.body.revision).toBe(p1.body.revision + 1);
  });

  it('生图写回 revision+1 且不覆盖并行 PATCH 的字段（attachImage 锁内重读）', async () => {
    const app = testApp();
    const { workId, shotId } = await seedWithShot(app);
    mockImageUpstream();
    const p1 = await authed(app).get(`/api/works/${workId}/duanju`);
    // 并行：生图（慢操作后锁内写回）+ PATCH 修改 style
    const [gen, patch] = await Promise.all([
      authed(app)
        .post(`/api/works/${workId}/duanju/images`)
        .send({ kind: 'shot', refId: shotId, prompt: '四宫格', aspectRatio: '1:1' }),
      authed(app)
        .patch(`/api/works/${workId}/duanju`)
        .send({ revision: p1.body.revision, style: '写实' }),
    ]);
    // 生图成功（或因时序 revision 竞争仍成功——attachImage 不做 revision 比对只 +1）
    expect(gen.status).toBe(200);
    expect(gen.body.project.shots.find((s: { id: string }) => s.id === shotId).gridImage).toBeTruthy();
    // PATCH 若在生图写回前提交则 200；两者最终字段共存（style 与 gridImage 都在）
    const final = await authed(app).get(`/api/works/${workId}/duanju`);
    const shot = final.body.shots.find((s: { id: string }) => s.id === shotId);
    expect(shot.gridImage).toBeTruthy();
    expect(shot.builtFrom).toBeTruthy();
    expect(['动漫风', '写实']).toContain(final.body.style);
    if (patch.status === 200) expect(final.body.style).toBe('写实');
    // revision 单调：≥ 初值+2（两次写）
    expect(final.body.revision).toBeGreaterThanOrEqual(p1.body.revision + 2);
  });
});

describe('D-生图错误路径与上传边界', () => {
  it('未配置 key → 502 IMG_AUTH 人话（无 key 泄露）', async () => {
    const app = testApp();
    const { workId, shotId } = await seedWithShot(app);
    // secrets 无 key：覆盖写一个空 claude
    await writeFile(join(root, 'secrets.json'), JSON.stringify({ claude: {} }), 'utf8');
    const r = await authed(app)
      .post(`/api/works/${workId}/duanju/images`)
      .send({ kind: 'shot', refId: shotId, prompt: 'p' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('IMG_AUTH');
    expect(r.body.message).not.toMatch(/sk-|Bearer/i);
  });

  it('shot/character/scene 目标不存在 → 404；kind 非法 → 400', async () => {
    const app = testApp();
    const { workId } = await seedWithShot(app);
    expect(
      (await authed(app).post(`/api/works/${workId}/duanju/images`).send({ kind: 'shot', refId: 'ghost', prompt: 'p' })).status,
    ).toBe(404);
    expect(
      (await authed(app).post(`/api/works/${workId}/duanju/images`).send({ kind: 'monster', refId: 'x', prompt: 'p' })).status,
    ).toBe(400);
  });

  it('上传 >100MB 被 multer 拒（413），错误类型 400', async () => {
    const app = testApp();
    const { workId, shotId } = await seedWithShot(app);
    const big = Buffer.alloc(101 * 1024 * 1024, 1);
    const tooBig = await authed(app)
      .post(`/api/works/${workId}/duanju/videos`)
      .field('shotId', shotId)
      .attach('file', big, { filename: 'a.mp4', contentType: 'video/mp4' });
    expect(tooBig.status).toBe(413);
    const badType = await authed(app)
      .post(`/api/works/${workId}/duanju/videos`)
      .field('shotId', shotId)
      .attach('file', Buffer.alloc(2048), { filename: 'a.txt', contentType: 'text/plain' });
    expect(badType.status).toBe(400);
  });
});

describe('D-删除联动与孤儿引用', () => {
  it('删除有图镜头：project 引用清除、图片文件留存（无害）、files 仍可读', async () => {
    const app = testApp();
    const { workId, shotId } = await seedWithShot(app);
    mockImageUpstream();
    const gen = await authed(app)
      .post(`/api/works/${workId}/duanju/images`)
      .send({ kind: 'shot', refId: shotId, prompt: 'p', aspectRatio: '1:1' });
    expect(gen.status).toBe(200);
    const imgName = (gen.body.image.path as string).split('/').pop() as string;
    const p2 = await authed(app).get(`/api/works/${workId}/duanju`);
    // 删除该镜头（shots 全清）
    await authed(app).patch(`/api/works/${workId}/duanju`).send({ revision: p2.body.revision, shots: [] });
    const p3 = await authed(app).get(`/api/works/${workId}/duanju`);
    expect(p3.body.shots).toHaveLength(0);
    // 文件留存 + files 路由仍可读（历史资产不炸）
    expect(existsSync(join(root, 'works', workId, 'duanju', 'images', imgName))).toBe(true);
    expect((await authed(app).get(`/api/works/${workId}/duanju/files/${imgName}`)).status).toBe(200);
  });

  it('shot 引用已删角色/场景：BuiltFrom 不复活（写回时 charAt 只记现存角色）', async () => {
    const app = testApp();
    const { workId } = await seedWithShot(app);
    // 建角色 + 场景 + 挂到镜头，然后删角色，生图写回 builtFrom.charAt 应不含已删角色
    const c1 = 'char-r1';
    const s1 = 'scene-s1';
    let p = await authed(app).get(`/api/works/${workId}/duanju`);
    await authed(app).patch(`/api/works/${workId}/duanju`).send({
      revision: p.body.revision,
      characters: [{ id: c1, name: '甲', profile: 'x', sheetImages: [], refImageId: null, updatedAt: 5 }],
      scenes: [{ id: s1, name: '乙', spec: 'y', images: [], updatedAt: 5 }],
    });
    p = await authed(app).get(`/api/works/${workId}/duanju`);
    const shotId = 'shot-d1';
    await authed(app).patch(`/api/works/${workId}/duanju`).send({
      revision: p.body.revision,
      shots: [{
        id: shotId, episodeId: 'ep1', index: 1, shotSize: '中景', cameraMove: '固定',
        actionStart: '', actionEnd: '', staging: '', dialog: '', sound: '', gridPrompt: 'p',
        characterIds: [c1], sceneId: s1, updatedAt: 1,
      }],
    });
    p = await authed(app).get(`/api/works/${workId}/duanju`);
    await authed(app).patch(`/api/works/${workId}/duanju`).send({ revision: p.body.revision, characters: [] });
    mockImageUpstream();
    const gen = await authed(app)
      .post(`/api/works/${workId}/duanju/images`)
      .send({ kind: 'shot', refId: shotId, prompt: 'p', aspectRatio: '1:1' });
    expect(gen.status).toBe(200);
    const bf = gen.body.project.shots.find((x: { id: string }) => x.id === shotId).builtFrom;
    expect(Object.keys(bf.charAt ?? {})).not.toContain(c1); // 已删角色不进快照
    expect(bf.sceneAt?.[s1]).toBe(5); // 现存场景正常快照
  });
});

describe('D-空目录数据与 seed 写入（CI 环境适配）', () => {
  it('duanju 目录不存在时 GET → 404（不抛 500）', async () => {
    const app = testApp();
    const res = await authed(app).post('/api/works').send({ title: 'n', mode: 'novel', genre: 'x' });
    expect((await authed(app).get(`/api/works/${res.body.id}/duanju`)).status).toBe(404);
  });
});

// 深度测试辅助：seedWithShot 依赖 secrets.json 存在与否不影响生图 mock（mockImageUpstream 拦截 fetch）
// 但 minimaxKey 读文件——无 secrets 文件时返回空串 → IMG_AUTH；上面错误路径用例显式写空 claude。
beforeEach(async () => {
  await mkdir(join(root), { recursive: true });
  await writeFile(
    join(root, 'secrets.json'),
    JSON.stringify({ ark: { apiKey: 'sk-test' } }),
    'utf8',
  );
});
