/**
 * P3.1 账号体系 + P3.2 留言板 + 读者过滤（深度测试 14 例，集成 createApp 全链路）
 *
 * auth：种子作者登录 / 旧单密码习惯 / 读者注册 / 重名拒绝 / 读者进创作域 403 / 作者放行
 * 过滤：读者 works 列表只见上架书 / 消息流只见上架章节正文（作者指令行隐藏）
 * 留言板：读者发+作者回 / 类型筛选数据完整 / 读者删自己 / 读者删他人 403 / 未登录 401
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
let readerId = '';

/** 便捷：造一本书（作者）+ 一章并上架 */
async function seedPublishedWork(title: string, publish: boolean): Promise<string> {
  const w = await request(app)
    .post('/api/works')
    .set('Cookie', authorCookie)
    .send({ title, mode: 'novel', genre: 'xuanhuan' });
  const workId = w.body.id as string;
  const chapter = {
    id: `ch-${title}`,
    role: 'assistant',
    name: '小说家',
    content: `${title}的第一章正文`,
    createdAt: Date.now(),
    swipes: [{ id: 'v1', name: 'v1', content: `${title}的第一章正文`, origin: 'ai', createdAt: Date.now() }],
    swipeId: 0,
    chapter: { index: 1, title: '第一章', ...(publish ? { publishedVersionId: 'v1' } : {}) },
    extra: {},
  };
  await request(app).post(`/api/works/${workId}/messages`).set('Cookie', authorCookie).send(chapter);
  const directive = { id: `dir-${title}`, role: 'user', name: '作者', content: `${title}的秘密指令`, createdAt: Date.now(), swipes: [{ id: 'sv', name: 'v1', content: 'x', origin: 'ai', createdAt: Date.now() }], swipeId: 0, extra: {} };
  await request(app).post(`/api/works/${workId}/messages`).set('Cookie', authorCookie).send(directive);
  return workId;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'p3-auth-'));
  process.env.DATA_DIR = root;
  process.env.ACCESS_PASSWORD = 'author-pw';
  app = createApp();
  // 作者登录（旧单密码习惯：不带 username）
  const a = await request(app).post('/api/auth/login').send({ password: 'author-pw' });
  authorCookie = a.headers['set-cookie'][0].split(';')[0];
  expect(a.body.user.role).toBe('author');
  // 读者注册
  const r = await request(app)
    .post('/api/auth/register')
    .send({ username: 'reader1', password: 'reader-pw-123', displayName: '小明' });
  readerCookie = r.headers['set-cookie'][0].split(';')[0];
  readerId = r.body.user.id;
  expect(r.body.user.role).toBe('reader');
  // 造书：一本上架一本未上架
  await seedPublishedWork('已上架的书', true);
  await seedPublishedWork('草稿书', false);
});

afterAll(async () => {
  delete process.env.DATA_DIR;
  delete process.env.ACCESS_PASSWORD;
  await rm(root, { recursive: true, force: true });
});

describe('P3.1 账号与权限分级', () => {
  it('种子作者可旧习惯登录（只输密码），读者凭用户名登录', async () => {
    const a = await request(app).post('/api/auth/login').send({ password: 'author-pw' });
    expect(a.status).toBe(200);
    const r = await request(app).post('/api/auth/login').send({ username: 'reader1', password: 'reader-pw-123' });
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('reader');
  });

  it('重名注册拒绝；/me 返回当前身份', async () => {
    const dup = await request(app).post('/api/auth/register').send({ username: 'reader1', password: 'whatever-123' });
    expect(dup.status).toBe(400);
    const me = await request(app).get('/api/auth/me').set('Cookie', readerCookie);
    expect(me.body.user).toMatchObject({ id: readerId, displayName: '小明', role: 'reader' });
  });

  it('读者进创作域（真实平铺路径 GET、works POST）被 403；作者放行', async () => {
    // 注意：library 组平铺挂载，真实路径无 /library 前缀——断言必须用真实路径才能守住此回归
    expect((await request(app).get('/api/characters').set('Cookie', readerCookie)).status).toBe(403);
    expect((await request(app).get('/api/factions').set('Cookie', readerCookie)).status).toBe(403);
    expect((await request(app).get('/api/llm/generate').set('Cookie', readerCookie)).status).toBe(403);
    expect((await request(app).post('/api/works').set('Cookie', readerCookie).send({ title: 'x', mode: 'novel', genre: 'hunhe' })).status).toBe(403);
    expect((await request(app).get('/api/characters').set('Cookie', authorCookie)).status).toBe(200);
  });

  it('读者 works 列表只见上架书', async () => {
    const res = await request(app).get('/api/works').set('Cookie', readerCookie);
    const titles = res.body.map((w: { title: string }) => w.title);
    expect(titles).toContain('已上架的书');
    expect(titles).not.toContain('草稿书');
  });

  it('读者消息流只见上架章节正文，作者指令行隐藏；作者全量可见', async () => {
    const list = await request(app).get('/api/works').set('Cookie', authorCookie);
    const workId = list.body.find((w: { title: string }) => w.title === '已上架的书').id;
    const reader = await request(app).get(`/api/works/${workId}/messages`).set('Cookie', readerCookie);
    expect(reader.body.messages).toHaveLength(1);
    expect(reader.body.messages[0].role).toBe('assistant');
    const author = await request(app).get(`/api/works/${workId}/messages`).set('Cookie', authorCookie);
    expect(author.body.messages).toHaveLength(2); // 章节 + 指令行
  });

  it('读者可以给上架书写评论（POST comments 放行）', async () => {
    const list = await request(app).get('/api/works').set('Cookie', readerCookie);
    const workId = list.body[0].id;
    const res = await request(app)
      .post(`/api/works/${workId}/comments`)
      .set('Cookie', readerCookie)
      .send({
        id: 'cm-1',
        author: { uid: readerId, name: '小明' },
        chapterMsgId: 'ch-已上架的书',
        chapterIndex: 1,
        versionId: 'v1',
        versionName: 'v1',
        paraIndex: 0,
        quote: '第一章正文',
        type: '感悟',
        text: '写得不错',
        createdAt: Date.now(),
      });
    expect(res.status).toBe(200);
  });
});

describe('P3.2 留言板', () => {
  it('读者发「想看」留言 → 列表可见且带署名', async () => {
    const res = await request(app).post('/api/community').set('Cookie', readerCookie).send({ type: '想看', text: '想看都市异能题材' });
    expect(res.status).toBe(201);
    const list = await request(app).get('/api/community').set('Cookie', readerCookie);
    const entry = list.body.entries.find((e: { text: string }) => e.text === '想看都市异能题材');
    expect(entry.author).toMatchObject({ uid: readerId, name: '小明' });
  });

  it('作者回复留言；回复内容落库', async () => {
    const created = await request(app).post('/api/community').set('Cookie', readerCookie).send({ type: '建议', text: '建议更新快点' });
    const reply = await request(app)
      .post(`/api/community/${created.body.id}/reply`)
      .set('Cookie', authorCookie)
      .send({ text: '加更安排上了' });
    expect(reply.status).toBe(200);
    expect(reply.body.reply).toMatchObject({ name: '作者', text: '加更安排上了' });
  });

  it('读者回复被拒（403，作者专属）', async () => {
    const created = await request(app).post('/api/community').set('Cookie', readerCookie).send({ type: '留言', text: '求互动' });
    const res = await request(app).post(`/api/community/${created.body.id}/reply`).set('Cookie', readerCookie).send({ text: '我自己回' });
    expect(res.status).toBe(403);
  });

  it('读者删自己的留言放行、删他人 403', async () => {
    const mine = await request(app).post('/api/community').set('Cookie', readerCookie).send({ type: '留言', text: '我的留言' });
    expect((await request(app).delete(`/api/community/${mine.body.id}`).set('Cookie', readerCookie)).status).toBe(200);
    const authors = await request(app).post('/api/community').set('Cookie', authorCookie).send({ type: '留言', text: '作者的留言' });
    expect((await request(app).delete(`/api/community/${authors.body.id}`).set('Cookie', readerCookie)).status).toBe(403);
  });

  it('未登录访问留言板 401', async () => {
    expect((await request(app).get('/api/community')).status).toBe(401);
  });
});
