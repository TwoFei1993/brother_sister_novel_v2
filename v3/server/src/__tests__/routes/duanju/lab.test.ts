/**
 * 短剧试验台路由测试（设计共识 2026-11-26 第 2.5 节；M2 增强：参考图）
 *
 * 覆盖：空历史 / 本地回流归档（不动 project revision、不写成本记录）/ 云端生成成功与失败
 * （失败不落记录、不留孤儿文件）/ 删除连同图片 / 校验与鉴权 / 超上限淘汰最旧；
 * 参考图：上传、路径白名单、Seedream 带图、GLM 不支持、删除与孤儿清理。
 * 上游用 fetch mock（生成接口 + 产物下载）。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

import { worksRouter } from '../../../routes/works';
import { signToken } from '../../../middleware/auth';
import { HttpError } from '../../../middleware/validate';
import { LAB_RECORDS_MAX, type LabFile, type LabRecord, type LabRef } from '@shared/duanju/lab';

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
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  };
}

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-duanju-lab-'));
  process.env.DATA_DIR = root;
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'secrets.json'), JSON.stringify({ ark: { apiKey: 'sk-test' } }), 'utf8');
  vi.stubGlobal('fetch', vi.fn());
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

async function createDuanju(app: Express): Promise<string> {
  const res = await authed(app).post('/api/works').send({ title: 't', mode: 'duanju', genre: 'x' });
  return res.body.id as string;
}

const png = Buffer.alloc(2048, 1);

const comfyMeta = {
  brief: '雨夜霓虹街头的女剑客',
  prompt: '电影感单帧：雨夜霓虹街头……',
  kind: 'free',
  provider: 'comfy',
  aspect: '9:16',
  width: 768,
  height: 1344,
  seed: 42,
  refs: [] as LabRef[],
  characterIds: [],
  sceneIds: [],
  elapsedSec: 91,
};

function uploadComfy(app: Express, workId: string, meta: unknown = comfyMeta) {
  return authed(app)
    .post(`/api/works/${workId}/duanju/lab/images`)
    .field('meta', JSON.stringify(meta))
    .attach('file', png, { filename: 'a.png', contentType: 'image/png' });
}

function uploadRef(app: Express, workId: string) {
  return authed(app).post(`/api/works/${workId}/duanju/lab/refs`).attach('file', png, { filename: 'r.png', contentType: 'image/png' });
}

function imagesDir(workId: string): string {
  return join(root, 'works', workId, 'duanju', 'images');
}

const cloudBody = { brief: 'b', prompt: 'p', kind: 'scene', aspect: '16:9', width: 2560, height: 1440, characterIds: [], sceneIds: [], refs: [] };

describe('试验台：历史与本地回流', () => {
  it('初始历史为空；回流归档后可读回，且不动 project revision、不写成本记录', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    expect((await authed(app).get(`/api/works/${id}/duanju/lab`)).body).toEqual({ records: [] });

    const res = await uploadComfy(app, id);
    expect(res.status).toBe(201);
    const rec = res.body.records[0];
    expect(rec).toMatchObject({ brief: comfyMeta.brief, prompt: comfyMeta.prompt, provider: 'comfy', aspect: '9:16', seed: 42, elapsedSec: 91 });
    expect(rec.image.path).toMatch(/^duanju\/images\/[\w-]+\.png$/);
    expect(existsSync(join(root, 'works', id, rec.image.path))).toBe(true);

    const list = await authed(app).get(`/api/works/${id}/duanju/lab`);
    expect(list.body.records).toHaveLength(1);
    // 产物可经现有文件流路由读取
    const file = await authed(app).get(`/api/works/${id}/duanju/files/${rec.image.path.split('/').pop()}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    // 不复用 images/upload 的副作用
    const project = await authed(app).get(`/api/works/${id}/duanju`);
    expect(project.body.revision).toBe(1);
    expect(project.body.spendLog).toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled(); // 本地通道不碰上游
  });

  it('校验：缺 file / 类型不支持 / meta 非法 → 400，且不落文件', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const noFile = await authed(app).post(`/api/works/${id}/duanju/lab/images`).field('meta', JSON.stringify(comfyMeta));
    expect(noFile.status).toBe(400);
    const badType = await authed(app)
      .post(`/api/works/${id}/duanju/lab/images`)
      .field('meta', JSON.stringify(comfyMeta))
      .attach('file', png, { filename: 'a.gif', contentType: 'image/gif' });
    expect(badType.status).toBe(400);
    const badMeta = await authed(app)
      .post(`/api/works/${id}/duanju/lab/images`)
      .field('meta', '{not json')
      .attach('file', png, { filename: 'a.png', contentType: 'image/png' });
    expect(badMeta.status).toBe(400);
    const missingField = await uploadComfy(app, id, { ...comfyMeta, brief: '' });
    expect(missingField.status).toBe(400);
    const unknownField = await uploadComfy(app, id, { ...comfyMeta, hack: true });
    expect(unknownField.status).toBe(400);
    expect(existsSync(imagesDir(id)) ? (await readdir(imagesDir(id))).length : 0).toBe(0);
  });

  it('作品不存在 → 404（不落图）', async () => {
    const app = testApp();
    const res = await uploadComfy(app, 'ghost-work');
    expect(res.status).toBe(404);
    expect(existsSync(join(root, 'works', 'ghost-work', 'duanju', 'images'))).toBe(false);
  });
});

describe('试验台：云端生成', () => {
  it('成功：上游生成 + 转存 + 落记录（seed 记 0）', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/a.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(png, { status: 200 }));
    const res = await authed(app).post(`/api/works/${id}/duanju/lab/generate`).send({ ...cloudBody, provider: 'seedream' });
    expect(res.status).toBe(201);
    expect(res.body.record).toMatchObject({ provider: 'seedream', aspect: '16:9', seed: 0, kind: 'scene', refs: [] });
    expect((await authed(app).get(`/api/works/${id}/duanju/lab`)).body.records).toHaveLength(1);
    // 没带参考图：请求体里没有 image 字段
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1]!.body as string)) as Record<string, unknown>;
    expect('image' in body).toBe(false);
  });

  it('上游失败 → 502，不落记录、不留孤儿文件', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 500 }));
    const res = await authed(app).post(`/api/works/${id}/duanju/lab/generate`).send({ ...cloudBody, provider: 'seedream' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('IMG_UPSTREAM');
    expect((await authed(app).get(`/api/works/${id}/duanju/lab`)).body).toEqual({ records: [] });
    expect(existsSync(imagesDir(id))).toBe(false);
  });

  it('本地通道不能走云端接口（provider 枚举拒绝）→ 400', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const res = await authed(app).post(`/api/works/${id}/duanju/lab/generate`).send({ ...cloudBody, provider: 'comfy' });
    expect(res.status).toBe(400);
  });
});

describe('试验台：删除与上限', () => {
  it('删除记录连同图片；再删 → 404', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const rec = (await uploadComfy(app, id)).body.records[0];
    const file = join(root, 'works', id, rec.image.path);
    expect(existsSync(file)).toBe(true);
    const del = await authed(app).delete(`/api/works/${id}/duanju/lab/${rec.id}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ records: [] });
    expect(existsSync(file)).toBe(false);
    expect((await authed(app).delete(`/api/works/${id}/duanju/lab/${rec.id}`)).status).toBe(404);
  });

  it('超出上限时淘汰最旧的记录', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const old = Array.from<unknown, LabRecord>({ length: LAB_RECORDS_MAX }, (_, i) => ({
      id: `lab-old-${i}`,
      createdAt: i + 1,
      brief: '旧记录',
      prompt: '旧记录提示词',
      kind: 'free',
      provider: 'comfy',
      aspect: '9:16',
      width: 768,
      height: 1344,
      seed: i,
      refs: [],
      characterIds: [],
      sceneIds: [],
      image: { id: `img-old-${i}`, path: `duanju/images/old-${i}.png`, prompt: '旧记录提示词', createdAt: i + 1 },
      elapsedSec: 1,
    }));
    const file = join(root, 'works', id, 'duanju', 'lab.json');
    await mkdir(join(root, 'works', id, 'duanju'), { recursive: true });
    await writeFile(file, JSON.stringify({ records: old } satisfies LabFile), 'utf8');
    const res = await uploadComfy(app, id);
    const ids = res.body.records.map((r: { id: string }) => r.id) as string[];
    expect(ids).toHaveLength(LAB_RECORDS_MAX);
    expect(ids[0]).toBe('lab-old-1'); // 最旧的一条被淘汰
    expect(ids.includes(res.body.records.at(-1).id)).toBe(true);
  });

  it('未登录 → 401', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    expect((await request(app).get(`/api/works/${id}/duanju/lab`)).status).toBe(401);
    expect((await request(app).delete(`/api/works/${id}/duanju/lab/x`)).status).toBe(401);
    expect((await request(app).post(`/api/works/${id}/duanju/lab/refs`)).status).toBe(401);
  });
});

describe('试验台：参考图', () => {
  const onDisk = (workId: string, path: string): string => join(root, 'works', workId, path);

  it('上传：返回 labref 路径，可经文件流路由读取，不动 project revision、不落记录', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const jpg = await authed(app)
      .post(`/api/works/${id}/duanju/lab/refs`)
      .attach('file', png, { filename: 'r.jpg', contentType: 'image/jpeg' });
    expect(jpg.status).toBe(201);
    expect(jpg.body.path).toMatch(/^duanju\/images\/labref-[\w-]+\.jpg$/);

    const res = await uploadRef(app, id);
    expect(res.status).toBe(201);
    expect(res.body.path).toMatch(/^duanju\/images\/labref-[\w-]+\.png$/);
    expect(existsSync(onDisk(id, res.body.path))).toBe(true);
    expect((await authed(app).get(`/api/works/${id}/duanju/files/${res.body.path.split('/').pop()}`)).status).toBe(200);
    expect((await authed(app).get(`/api/works/${id}/duanju/lab`)).body).toEqual({ records: [] });
    expect((await authed(app).get(`/api/works/${id}/duanju`)).body.revision).toBe(1);
  });

  it('只收 png / jpg：gif 与 webp → 400；缺文件 → 400；作品不存在 → 404', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    for (const type of ['image/gif', 'image/webp']) {
      const res = await authed(app).post(`/api/works/${id}/duanju/lab/refs`).attach('file', png, { filename: 'r.bin', contentType: type });
      expect(res.status).toBe(400);
    }
    expect((await authed(app).post(`/api/works/${id}/duanju/lab/refs`)).status).toBe(400);
    expect((await uploadRef(app, 'ghost-work')).status).toBe(404);
    expect(existsSync(imagesDir(id))).toBe(false);
  });

  it('路径白名单：meta 里写别的路径 → 400（读不到作品图片目录以外的文件）', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const res = await uploadComfy(app, id, { ...comfyMeta, refs: [{ path: '../secrets.json', caption: '' }] });
    expect(res.status).toBe(400);
    expect((await authed(app).get(`/api/works/${id}/duanju/lab`)).body).toEqual({ records: [] });
  });

  it('Seedream 带参考图：请求体含 image（DataURL），记录保存参考图', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const path = (await uploadRef(app, id)).body.path as string;
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/a.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(png, { status: 200 }));
    const refs = [{ path, caption: '底图：客厅夜景' }];
    const res = await authed(app).post(`/api/works/${id}/duanju/lab/generate`).send({ ...cloudBody, provider: 'seedream', refs });
    expect(res.status).toBe(201);
    expect(res.body.record.refs).toEqual(refs);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1]!.body as string)) as { image?: string; prompt: string };
    expect(body.image).toMatch(/^data:image\/png;base64,/);
    expect(body.prompt).toBe(cloudBody.prompt);
  });

  it('参考图文件已不在 → 400 且不调上游（花钱之前拦住）', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const ghost = { path: 'duanju/images/labref-00000000-dead-beef.png', caption: '' };
    const res = await authed(app).post(`/api/works/${id}/duanju/lab/generate`).send({ ...cloudBody, provider: 'seedream', refs: [ghost] });
    expect(res.status).toBe(400);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('GLM-Image 不支持参考图 → 400，不调上游', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const path = (await uploadRef(app, id)).body.path as string;
    const res = await authed(app)
      .post(`/api/works/${id}/duanju/lab/generate`)
      .send({ ...cloudBody, provider: 'zhipu', refs: [{ path, caption: '' }] });
    expect(res.status).toBe(400);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('本地回流带参考图：记录保存它们；盘上已不在的不写进记录（产物照常归档）', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const path = (await uploadRef(app, id)).body.path as string;
    const refs = [{ path, caption: 'a' }, { path: 'duanju/images/labref-00000000-0000-0000.png', caption: '已丢' }];
    const res = await uploadComfy(app, id, { ...comfyMeta, refs });
    expect(res.status).toBe(201);
    expect(res.body.records[0].refs).toEqual([{ path, caption: 'a' }]);
  });

  it('删除记录：连带删它独占的参考图；别的记录还在用的不删', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const path = (await uploadRef(app, id)).body.path as string;
    const refs = [{ path, caption: '共用' }];
    await uploadComfy(app, id, { ...comfyMeta, seed: 1, refs });
    const two = (await uploadComfy(app, id, { ...comfyMeta, seed: 2, refs })).body.records as LabRecord[];
    expect(two).toHaveLength(2);

    await authed(app).delete(`/api/works/${id}/duanju/lab/${two[0]!.id}`);
    expect(existsSync(onDisk(id, path))).toBe(true); // 第二条还在用

    await authed(app).delete(`/api/works/${id}/duanju/lab/${two[1]!.id}`);
    expect(existsSync(onDisk(id, path))).toBe(false);
  });

  it('归档新记录时清理：上传超过 2 小时且没人引用的参考图', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const orphan = (await uploadRef(app, id)).body.path as string;
    const used = (await uploadRef(app, id)).body.path as string;
    const fresh = (await uploadRef(app, id)).body.path as string;
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    for (const p of [orphan, used]) await utimes(onDisk(id, p), old, old);

    await uploadComfy(app, id, { ...comfyMeta, refs: [{ path: used, caption: '' }] });
    expect(existsSync(onDisk(id, orphan))).toBe(false); // 老的孤儿：清掉
    expect(existsSync(onDisk(id, used))).toBe(true); // 被刚归档的记录引用
    expect(existsSync(onDisk(id, fresh))).toBe(true); // 刚上传的（可能是别的在途任务的）：不动
  });

  it('参考图超过 10MB → 400（服务端也拦，不只靠界面）', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const res = await authed(app)
      .post(`/api/works/${id}/duanju/lab/refs`)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('10MB');
    expect(existsSync(imagesDir(id))).toBe(false);
  });
});

describe('试验台：记录没了的时候图片也要清', () => {
  const onDisk = (workId: string, name: string): string => join(root, 'works', workId, 'duanju', 'images', name);

  /** 预置一批旧记录（图文件名 old-<序号>.png） */
  async function seedOldRecords(app: Express, workId: string, count: number): Promise<void> {
    const old = Array.from<unknown, LabRecord>({ length: count }, (_, i) => ({
      id: `lab-old-${i}`,
      createdAt: i + 1,
      brief: '旧记录',
      prompt: '旧记录提示词',
      kind: 'free',
      provider: 'comfy',
      aspect: '9:16',
      width: 768,
      height: 1344,
      seed: i,
      refs: [],
      characterIds: [],
      sceneIds: [],
      image: { id: `img-old-${i}`, path: `duanju/images/old-${i}.png`, prompt: '旧记录提示词', createdAt: i + 1 },
      elapsedSec: 1,
    }));
    const dir = join(root, 'works', workId, 'duanju');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'lab.json'), JSON.stringify({ records: old } satisfies LabFile), 'utf8');
  }

  it('超出上限淘汰最旧的记录时，连同它的产物图一起删（不然越积越多）', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    await seedOldRecords(app, id, LAB_RECORDS_MAX);
    await mkdir(imagesDir(id), { recursive: true });
    await writeFile(onDisk(id, 'old-0.png'), png); // 被淘汰的那条的图
    await writeFile(onDisk(id, 'old-1.png'), png); // 留下来的那条的图

    const res = await uploadComfy(app, id);
    expect(res.status).toBe(201);
    expect(res.body.records[0].id).toBe('lab-old-1');
    expect(existsSync(onDisk(id, 'old-0.png'))).toBe(false);
    expect(existsSync(onDisk(id, 'old-1.png'))).toBe(true);
  });

  it('云端生成成功但记录没写成：回滚刚转存的图，不留孤儿', async () => {
    const app = testApp();
    const id = await createDuanju(app);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/a.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(png, { status: 200 }));
    // 让 lab.json 是个目录：读不了也写不了 → 追加记录必失败
    const dir = join(root, 'works', id, 'duanju');
    await mkdir(join(dir, 'lab.json'), { recursive: true });
    await writeFile(join(dir, 'lab.json', 'work.json'), '{}', 'utf8'); // 非空目录：删不掉

    const res = await authed(app).post(`/api/works/${id}/duanju/lab/generate`).send({ ...cloudBody, provider: 'seedream' });
    expect(res.status).toBe(500);
    expect(existsSync(imagesDir(id)) ? (await readdir(imagesDir(id))).length : 0).toBe(0);
  });
});
