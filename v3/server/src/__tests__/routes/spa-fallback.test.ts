/**
 * SPA 历史回退测试（生产构建 PUBLIC_DIR 存在时）：
 * 非 API/非资源且无扩展名的 GET → index.html（react-router 深链接/刷新不 404）；
 * API 未命中与带扩展名的缺失资源仍 404 JSON。
 * PUBLIC_DIR 是 app.ts 模块级常量——必须在动态 import 前设 env 指向临时目录。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

let publicDir = '';
let app: Awaited<ReturnType<typeof import('../../app').createApp>>;

beforeAll(async () => {
  publicDir = await mkdtemp(join(tmpdir(), 'v3-public-'));
  process.env.PUBLIC_DIR = publicDir;
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, 'index.html'), '<html><body>SPA-MARKER</body></html>');
  process.env.ACCESS_PASSWORD = 'spa-test';
  const mod = await import('../../app');
  app = mod.createApp();
});

afterAll(async () => {
  delete process.env.PUBLIC_DIR;
  delete process.env.ACCESS_PASSWORD;
  await rm(publicDir, { recursive: true, force: true });
});

describe('SPA 历史回退（生产构建）', () => {
  it('深链接 /login → 200 index.html（不再打 API 404）', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('SPA-MARKER');
  });

  it('嵌套路由 /library/deep → 200', async () => {
    const res = await request(app).get('/library/deep');
    expect(res.status).toBe(200);
    expect(res.text).toContain('SPA-MARKER');
  });

  it('API 未命中：未登录 401（鉴权门在前）；登录后 404 JSON（不被回退吞掉）', async () => {
    expect((await request(app).get('/api/nonexistent')).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ password: 'spa-test' });
    const cookie = Array.isArray(login.headers['set-cookie'])
      ? login.headers['set-cookie'].join('; ').split(';')[0]
      : String(login.headers['set-cookie'] ?? '').split(';')[0];
    const res = await request(app).get('/api/nonexistent').set('cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('接口不存在');
  });

  it('带扩展名的缺失资源仍 404（不回 HTML）', async () => {
    const res = await request(app).get('/assets/missing.js');
    expect(res.status).toBe(404);
  });
});
