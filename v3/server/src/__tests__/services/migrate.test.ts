/**
 * 旧数据迁移测试（TDD，Task 31）
 *
 * 服务层：migrateNovelHistory 纯函数——NovelProject[] → {work, messages}[]。
 *   覆盖：work.mode/genre/title、chapter.index 连续、versions→swipes+swipeId、
 *   无版本章节兜底、settings 逐字段映射（含 worldBuilding→legacyWorldBuilding、
 *   缺省补默认、未知字段丢弃）、stats 计算、createdAt 单调。
 * 路由层：POST /api/migrate/novel-history——未登录 401、非法 body 400、
 *   成功迁移落盘（work.json + messages.jsonl 行数）+ GET /api/works 列表可见。
 *
 * 路由走真实 createApp()（coreRouter 已挂 migrateRouter），DATA_DIR 注入临时目录。
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../app';
import { migrateNovelHistory } from '../../services/migrate';

const PASSWORD = 'migrate-test';

// ---------- 旧站 NovelProject fixture（结构与旧 src/types/novel.ts 对齐，刻意带旧站特有字段） ----------
function makeLegacyProjects(): Record<string, unknown>[] {
  return [
    {
      id: 'legacy-a',
      title: '旧站小说A',
      createdAt: 1700000000000,
      updatedAt: 1700000864000,
      genre: undefined, // 旧站 genre 在 settings 内，顶层无此字段（宽松输入不该被顶层字段污染）
      settings: {
        genre: 'scifi',
        subGenre: '星际机甲',
        brotherAge: 25,
        sisterAge: 17,
        pastedOutline: '第一章：兄妹坠入星海',
        legacyOnlyField: '旧站脏字段', // 新 schema 无此字段，应被丢弃
      },
      worldBuilding: { content: '世界观：灵气与科技并存的星际大陆' },
      chapters: [
        {
          id: 0,
          title: '初入异世',
          content: '第一章正文v1',
          versions: [
            { content: '第一章正文v1', title: '原版', label: '原版' },
            { content: '第一章正文v2', title: '改写v1', label: '改写v1' },
          ],
          currentVersionIndex: 1,
        },
        {
          id: 1,
          title: '宗门试炼',
          content: '第二章正文v1',
          versions: [
            { content: '第二章正文v1', label: '原版' },
            { content: '第二章正文v2', label: '改写v1' },
            { content: '第二章正文v3', label: '改写v2' },
          ],
          currentVersionIndex: 2,
        },
        { id: 2, title: '意外收获', content: '第三章正文' },
      ],
    },
    {
      id: 'legacy-b',
      title: '旧站小说B',
      createdAt: 1700001000000,
      settings: { genre: 'xuanhuan', brotherAge: 22 },
      worldBuilding: { content: '' },
      chapters: [{ id: 0, title: '唯一章节', content: '唯一章节正文' }],
    },
  ];
}

// ---------- 服务层 ----------
describe('migrateNovelHistory 纯函数', () => {
  it('每个旧项目 → 一个 Work：mode=novel、title/genre 保留、revision=1、服务端字段就位', () => {
    const { works } = migrateNovelHistory(makeLegacyProjects() as never[]);
    expect(works).toHaveLength(2);
    const [a, b] = works.map((w) => w.work);
    expect(a.mode).toBe('novel');
    expect(a.title).toBe('旧站小说A');
    expect(a.genre).toBe('scifi');
    expect(b.genre).toBe('xuanhuan');
    expect(a.revision).toBe(1);
    expect(a.id).toMatch(/^[\w-]{10,}$/); // uuid 形态
    expect(a.characterIds).toEqual([]);
    expect(a.presetId).toBe('');
    expect(a.voiceMap).toEqual({});
    expect(typeof a.createdAt).toBe('number');
  });

  it('每章节 → 一条 Message：role/name/chapter.index 连续且 title 对应', () => {
    const { works } = migrateNovelHistory(makeLegacyProjects() as never[]);
    const msgs = works[0].messages;
    expect(msgs).toHaveLength(3);
    expect(msgs.map((m) => m.role)).toEqual(['assistant', 'assistant', 'assistant']);
    expect(msgs.every((m) => m.name === '小说家')).toBe(true);
    expect(msgs.map((m) => m.chapter?.index)).toEqual([1, 2, 3]);
    expect(msgs.map((m) => m.chapter?.title)).toEqual(['初入异世', '宗门试炼', '意外收获']);
  });

  it('versions → swipes 映射：content=当前版本正文、swipeId=currentVersionIndex', () => {
    const { works } = migrateNovelHistory(makeLegacyProjects() as never[]);
    const msgs = works[0].messages;
    expect(msgs[0].swipes).toEqual(['第一章正文v1', '第一章正文v2']);
    expect(msgs[0].swipeId).toBe(1);
    expect(msgs[0].content).toBe('第一章正文v2');
    expect(msgs[1].swipes).toEqual(['第二章正文v1', '第二章正文v2', '第二章正文v3']);
    expect(msgs[1].swipeId).toBe(2);
    expect(msgs[1].content).toBe('第二章正文v3');
  });

  it('无版本章节兜底：swipes=[content]、swipeId=0', () => {
    const { works } = migrateNovelHistory(makeLegacyProjects() as never[]);
    const only = works[1].messages[0];
    expect(only.content).toBe('唯一章节正文');
    expect(only.swipes).toEqual(['唯一章节正文']);
    expect(only.swipeId).toBe(0);
    // A 的第三章（无 versions 字段）同样兜底
    const third = works[0].messages[2];
    expect(third.swipes).toEqual(['第三章正文']);
    expect(third.swipeId).toBe(0);
  });

  it('settings 逐字段映射：旧值保留、worldBuilding.content → legacyWorldBuilding、缺省补默认、未知字段丢弃', () => {
    const { works } = migrateNovelHistory(makeLegacyProjects() as never[]);
    const s = works[0].work.settings;
    expect(s.brotherAge).toBe(25);
    expect(s.subGenre).toBe('星际机甲');
    expect(s.pastedOutline).toBe('第一章：兄妹坠入星海');
    expect(s.legacyWorldBuilding).toBe('世界观：灵气与科技并存的星际大陆');
    // 旧站没有的新字段补默认值
    expect(s.authorNote).toBe('');
    expect(s.noteDepth).toBe(4);
    // 旧站脏字段不得混入（NovelSettings strict 校验也会拒绝）
    expect((s as Record<string, unknown>).legacyOnlyField).toBeUndefined();
    // B 作品 worldBuilding 为空串 → legacyWorldBuilding 省略（optional 语义）
    expect(works[1].work.settings.legacyWorldBuilding).toBeUndefined();
  });

  it('stats 由 messages 计算：messageCount/chapterCount/charCount', () => {
    const { works } = migrateNovelHistory(makeLegacyProjects() as never[]);
    const a = works[0].work;
    expect(a.stats).toEqual({
      messageCount: 3,
      chapterCount: 3,
      charCount: '第一章正文v2'.length + '第二章正文v3'.length + '第三章正文'.length,
    });
  });

  it('消息 createdAt = 项目 createdAt + 章节序×60000，严格单调递增；work.updatedAt ≥ 末条消息', () => {
    const { works } = migrateNovelHistory(makeLegacyProjects() as never[]);
    const a = works[0];
    const base = 1700000000000;
    expect(a.messages.map((m) => m.createdAt)).toEqual([
      base + 60000,
      base + 120000,
      base + 180000,
    ]);
    expect(a.work.updatedAt).toBeGreaterThanOrEqual(a.messages[2].createdAt);
  });
});

// ---------- 路由层 ----------
describe('POST /api/migrate/novel-history', () => {
  let root = '';
  let app: Express;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'v3-migrate-'));
    process.env.ACCESS_PASSWORD = PASSWORD;
    process.env.DATA_DIR = root;
    app = createApp();
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function loginCookie(): Promise<string> {
    const res = await request(app).post('/api/auth/login').send({ password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const joined = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    return `token=${joined.match(/token=([^;]+)/)![1]}`;
  }

  it('未登录 → 401', async () => {
    const res = await request(app).post('/api/migrate/novel-history').send([]);
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('非法 body → 400：非数组 / 元素缺 title / 元素缺 chapters', async () => {
    const cookie = await loginCookie();
    const url = '/api/migrate/novel-history';
    expect((await request(app).post(url).set('Cookie', cookie).send({ title: 'x' })).status).toBe(400);
    expect(
      (await request(app).post(url).set('Cookie', cookie).send([{ chapters: [] }])).status,
    ).toBe(400);
    expect(
      (await request(app).post(url).set('Cookie', cookie).send([{ title: '缺章节' }])).status,
    ).toBe(400);
  });

  it('迁移成功：落盘 work.json + messages.jsonl 行数正确，返回 workIds，GET /api/works 列表可见', async () => {
    const cookie = await loginCookie();
    const res = await request(app)
      .post('/api/migrate/novel-history')
      .set('Cookie', cookie)
      .send(makeLegacyProjects());
    expect(res.status).toBe(200);
    expect(res.body.migrated).toBe(2);
    expect(res.body.workIds).toHaveLength(2);

    const idA = res.body.workIds[0] as string;
    expect(existsSync(join(root, 'works', idA, 'work.json'))).toBe(true);
    const jsonl = await readFile(join(root, 'works', idA, 'messages.jsonl'), 'utf8');
    expect(jsonl.trim().split('\n')).toHaveLength(3);
    const firstLine = JSON.parse(jsonl.split('\n')[0]) as { chapter?: { title: string } };
    expect(firstLine.chapter?.title).toBe('初入异世');

    const list = await request(app).get('/api/works').set('Cookie', cookie);
    expect(list.status).toBe(200);
    const titles = (list.body as { title: string }[]).map((w) => w.title);
    expect(titles).toContain('旧站小说A');
    expect(titles).toContain('旧站小说B');
  });
});
