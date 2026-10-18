/**
 * core 路由测试（TDD，Task 5）：config / secrets / health
 *
 * 覆盖：config 默认值与回读、zod 400、鉴权拦截；
 * secrets 明文落盘 + GET 只回掩码；health 免鉴权、存储探针、TTS unset/down。
 * 数据全部落在 os.tmpdir() 下随机临时目录（DATA_DIR 每次请求实时读 env，与 auth 同约定）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../app';

const PASSWORD = 'core-test';
let dataDir = '';

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'v3-core-'));
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

// 每个用例前：设好 env 并清掉持久化文件，保证用例互不污染
beforeEach(async () => {
  process.env.ACCESS_PASSWORD = PASSWORD;
  process.env.DATA_DIR = dataDir;
  await rm(join(dataDir, 'config.json'), { force: true });
  await rm(join(dataDir, 'secrets.json'), { force: true });
});

/** 登录拿合法 cookie（供鉴权后的接口复访） */
async function loginCookie(app: Express): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ password: PASSWORD });
  expect(res.status).toBe(200);
  const setCookie = res.headers['set-cookie'];
  const joined = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
  return `token=${joined.match(/token=([^;]+)/)![1]}`;
}

describe('GET/PUT /api/config', () => {
  it('文件不存在 → 200 返回默认值（globalVariables 空对象、无 ttsBaseUrl）', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/config')
      .set('Cookie', await loginCookie(app));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ globalVariables: {} });
  });

  it('PUT 合法配置后 GET 回读一致', async () => {
    const app = createApp();
    const cookie = await loginCookie(app);
    const body = {
      ttsBaseUrl: 'http://127.0.0.1:59999',
      globalVariables: { hero: '阿哥' },
    };
    const put = await request(app).put('/api/config').set('Cookie', cookie).send(body);
    expect(put.status).toBe(200);

    const res = await request(app).get('/api/config').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
  });

  it('PUT 非法（ttsBaseUrl 非字符串）→ 400', async () => {
    const app = createApp();
    const res = await request(app)
      .put('/api/config')
      .set('Cookie', await loginCookie(app))
      .send({ ttsBaseUrl: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('config 走鉴权：无 cookie GET → 401', async () => {
    const res = await request(createApp()).get('/api/config');
    expect(res.status).toBe(401);
  });
});

describe('GET/PUT /api/secrets', () => {
  const keys = {
    openai: { apiKey: 'sk-plain-text-secret-001', baseUrl: 'https://api.openai.com/v1' },
    gemini: { apiKey: 'gemini-plain-text-002' },
  };

  it('PUT 后 GET 只见布尔掩码，响应任何位置不含明文密钥', async () => {
    const app = createApp();
    const cookie = await loginCookie(app);
    const put = await request(app).put('/api/secrets').set('Cookie', cookie).send(keys);
    expect(put.status).toBe(200);

    const res = await request(app).get('/api/secrets').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ openai: true, gemini: true, claude: false });
    expect(res.text).not.toContain('sk-plain-text-secret-001');
    expect(res.text).not.toContain('gemini-plain-text-002');
  });

  it('PUT 后 data/secrets.json 落盘存在且含明文（服务端调用 LLM 需要原文）', async () => {
    const app = createApp();
    await request(app)
      .put('/api/secrets')
      .set('Cookie', await loginCookie(app))
      .send(keys);
    const raw = await readFile(join(dataDir, 'secrets.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual(keys);
  });

  it('未配置密钥时 GET → 三通道全 false', async () => {
    const app = createApp();
    const res = await request(app).get('/api/secrets').set('Cookie', await loginCookie(app));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ openai: false, gemini: false, claude: false });
  });

  it('PUT 非法（apiKey 缺失）→ 400', async () => {
    const app = createApp();
    const res = await request(app)
      .put('/api/secrets')
      .set('Cookie', await loginCookie(app))
      .send({ openai: { baseUrl: 'https://api.openai.com/v1' } });
    expect(res.status).toBe(400);
  });

  it('secrets 走鉴权：无 cookie PUT → 401', async () => {
    const res = await request(createApp()).put('/api/secrets').send(keys);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/health（免鉴权）', () => {
  it('无 cookie 可访问 200：storage ok / tts unset / llm 全 false', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      storage: 'ok',
      tts: 'unset',
      llm: { openai: false, gemini: false, claude: false },
    });
  });

  it('config 配置不可达 TTS 地址 → tts down（连接被拒，秒级返回）', async () => {
    const app = createApp();
    await request(app)
      .put('/api/config')
      .set('Cookie', await loginCookie(app))
      .send({ ttsBaseUrl: 'http://127.0.0.1:1', globalVariables: {} });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.tts).toBe('down');
  });

  it('写入密钥后 llm 通道掩码变 true', async () => {
    const app = createApp();
    const cookie = await loginCookie(app);
    await request(app)
      .put('/api/secrets')
      .set('Cookie', cookie)
      .send({ claude: { apiKey: 'claude-key-003' } });
    const res = await request(app).get('/api/health');
    expect(res.body.llm).toEqual({ openai: false, gemini: false, claude: true });
  });
});
