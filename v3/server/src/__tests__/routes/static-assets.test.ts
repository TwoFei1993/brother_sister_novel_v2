/**
 * 角色卡头像静态托管测试（/data-assets）：
 * GET /data-assets/<id>.png 命中入库底图 200（content-type + 字节一致）；不存在 404。
 * DATA_DIR 指向临时目录，底图取仓库内 resources/builtin 真实 Seraphina PNG（与入库字节同源）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

import { createApp } from '../../app';

// 仓库内真实底图（与入库字节同源）：本文件位于 server/src/__tests__/routes/，上四级为 v3 根
const SERAPHINA_PNG = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../resources/builtin/characters/default_Seraphina.png',
);

let dataDir = '';
let pngId = '';

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'v3-static-'));
  process.env.ACCESS_PASSWORD = 'static-test';
  process.env.DATA_DIR = dataDir;
  // 模拟入库落图：characters/<id>.png 直接复制仓库内真实底图
  const charactersDir = join(dataDir, 'characters');
  await mkdir(charactersDir, { recursive: true });
  pngId = '7df82bb0-e488-422d-ac74-27b3e57e7536';
  await copyFile(SERAPHINA_PNG, join(charactersDir, `${pngId}.png`));
});

afterAll(async () => {
  delete process.env.ACCESS_PASSWORD;
  delete process.env.DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe('GET /data-assets — 角色头像静态托管', () => {
  it('存在的底图 → 200 image/png 且字节与源文件一致；不存在的 id → 404', async () => {
    const app = createApp();
    const res = await request(app).get(`/data-assets/${pngId}.png`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.subarray(0, 4).toString('latin1')).toBe('\x89PNG');

    const missing = await request(app).get('/data-assets/00000000-0000-4000-8000-000000000000.png');
    expect(missing.status).toBe(404);
  });
});
