/**
 * 听书合成权限测试（压力测试回归：读者 POST /api/tts/minimax 曾被外层 guard 误拦 403）：
 * - 读者：登录后可调合成（无密钥环境 503=权限已放行，配置层另有兜底）
 * - 未登录：401
 * - 作者：可调
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../app';

let app: Express;
let root = '';
let authorCookie = '';
let readerCookie = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-tts-'));
  process.env.DATA_DIR = root;
  process.env.ACCESS_PASSWORD = 'author-pw';
  app = createApp();
  const author = await request(app).post('/api/auth/login').send({ password: 'author-pw' });
  authorCookie = author.headers['set-cookie'][0].split(';')[0];
  expect(author.body.user.role).toBe('author');
  await request(app).post('/api/auth/register').send({ username: 'r1', password: 'r1-pass' });
  const reader = await request(app).post('/api/auth/login').send({ username: 'r1', password: 'r1-pass' });
  readerCookie = reader.headers['set-cookie'][0].split(';')[0];
  expect(reader.body.user.role).toBe('reader');
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

const synth = (cookie: string): request.Test =>
  request(app).post('/api/tts/minimax').set('Cookie', cookie).send({ text: '测试', voiceId: 'female-shaonv' });

describe('TTS 听书权限分级', () => {
  it('未登录 401', async () => {
    expect((await request(app).post('/api/tts/minimax').send({ text: 'x', voiceId: 'female-shaonv' })).status).toBe(401);
  });

  it('读者登录后权限放行（无密钥环境为 503 配置错误而非 403 权限错误）', async () => {
    const r = await synth(readerCookie);
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(403);
  });

  it('作者同样放行', async () => {
    const r = await synth(authorCookie);
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(403);
  });
});
