/**
 * 资源中心路由测试 — index 与 builtin fetch（TDD，Task 30）
 *
 * builtin 用例直接读仓库内 resources/builtin/ 真实文件（同时验证索引与文件一致），
 * 不触真实网络。remote fetch 与安全收口见 resources-remote.test.ts，装置见 resources-setup.ts。
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';

import { libraryDir } from '../../../routes/library/crud';

import { authed, makeApp } from './resources-setup';

describe('GET /api/io/resources/index', () => {
  it('返回全量精选条目且字段完整（>0 条）', async () => {
    const res = await request(makeApp()).get('/api/io/resources/index').set(authed());
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThan(0);
    for (const e of res.body.entries) {
      expect(e.id).toBeTruthy();
      expect(['preset', 'worldbook', 'character', 'regex']).toContain(e.type);
      expect(e.name).toBeTruthy();
      expect(e.description).toBeTruthy();
      expect(['builtin', 'remote']).toContain(e.ref.kind);
      expect(e.license).toBeTruthy();
    }
  });
});

describe('POST /api/io/resources/fetch — builtin', () => {
  it('导入 Eldoria 世界书并入库，可回读 raw.entries', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'builtin', path: 'builtin/worldbooks/Eldoria.json' });
    expect(res.status).toBe(201);
    expect(res.body.assetType).toBe('worldbooks');
    expect(res.body.id).toBeTruthy();

    const back = await request(app).get(`/api/worldbooks/${res.body.id}`).set(authed());
    expect(back.status).toBe(200);
    expect(back.body.name).toBe('Eldoria');
    expect(Object.keys(back.body.raw.entries).length).toBeGreaterThan(0);
  });

  it('导入 sysprompt 文本冒险系统提示词 → 合成为最小预设入库', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'builtin', path: 'builtin/sysprompts/Text Adventure.json' });
    expect(res.status).toBe(201);
    expect(res.body.assetType).toBe('presets');
    expect(res.body.name).toBe('Text Adventure');

    const back = await request(app).get(`/api/presets/${res.body.id}`).set(authed());
    expect(back.status).toBe(200);
    expect(back.body.raw.prompts[0].identifier).toBe('sysprompt');
    expect(back.body.raw.prompts[0].content).toContain('Adventure Mode');
  });

  it('导入 Seraphina PNG 卡 → 角色入库并落底图', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'builtin', path: 'builtin/characters/default_Seraphina.png' });
    expect(res.status).toBe(201);
    expect(res.body.assetType).toBe('characters');
    expect(res.body.name).toContain('Seraphina');

    const back = await request(app).get(`/api/characters/${res.body.id}`).set(authed());
    expect(back.status).toBe(200);
    expect(back.body.avatar).toBe(`/data-assets/characters/${res.body.id}.png`);
    const png = await readFile(join(libraryDir('characters'), `${res.body.id}.png`));
    expect(png.subarray(0, 4).toString('latin1')).toBe('\x89PNG');
  });

  it('路径穿越（../ 与盘符）一律 400，白名单外路径 404', async () => {
    const app = makeApp();
    for (const path of ['../index.json', 'C:/Windows/system.ini', '..\\server\\src\\app.ts']) {
      const res = await request(app)
        .post('/api/io/resources/fetch')
        .set(authed())
        .send({ kind: 'builtin', path });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('非法');
    }
    const missing = await request(app)
      .post('/api/io/resources/fetch')
      .set(authed())
      .send({ kind: 'builtin', path: 'builtin/not-exist.json' });
    expect(missing.status).toBe(404);
  });
});
