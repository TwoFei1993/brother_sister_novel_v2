/**
 * 同人原著资料导入端点测试（用户需求 2026-11-22 + 用户授权联网搜索）：
 * collectWithDefense mock（联网侧不实调）——验证 JSON 解析容错、世界书创建、work 绑定、
 * 非 fanfic 拒绝、LLM 输出不可解析时的 502。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authRequired, signToken } from '../middleware/auth';
import { HttpError } from '../middleware/validate';
import { readJson, writeJsonAtomic } from '../storage/store';
import { workFile } from '../routes/works/works';
import { libraryDir } from '../routes/library/crud';
import { defaultNovelSettings, type Work } from '@shared/work';

const fetchMock = vi.fn();
const okResp = (text: string): { ok: boolean; json: () => Promise<unknown> } => ({
  ok: true,
  json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
});

const { fandomRouter } = await import('../routes/works/fandom');
const { worksDir } = await import('../routes/works/works');

let root = '';
let app: Express;
const WID = 'w-fandom-1';

function workFixture(genre: string): Work {
  return {
    id: WID,
    revision: 1,
    title: '同人测试书',
    mode: 'novel',
    genre,
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings, genre: genre as never },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

const authed = (req: Request, _res: Response, next: NextFunction): void => {
  (req as Request & { auth?: unknown }).auth = { role: 'author', uid: 'pt' };
  next();
};

async function loginHeader(): Promise<string> {
  return `sid=${signToken({ role: 'author', uid: 'pt' })}`;
}

const OK_JSON = JSON.stringify([
  { title: '主要人物与关系', keys: ['克莱恩'], content: '主角克莱恩，性格谨慎……' },
  { title: '世界观', keys: ['蒸汽时代'], content: '维多利亚风格蒸汽与机械的世界……' },
]);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-fandom-'));
  process.env.DATA_DIR = root;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  await writeJsonAtomic(workFile(WID), workFixture('fanfic'));
  // 专用客户端读 DATA_DIR/secrets.json 的 claude key——测试注入假 key（fetch 已 mock 不真调）
  await writeJsonAtomic(join(root, 'secrets.json'), { claude: { apiKey: 'test-key', baseUrl: 'https://api.minimaxi.com/anthropic' } });

  const testError = (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  };
  app = express();
  app.use(express.json());
  app.use('/works/:id', authed);
  app.use('/works/:id', fandomRouter);
  app.get('/works/:id/ping', (req, res) => res.json({ ok: true, id: req.params.id }));
  app.use(testError);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.DATA_DIR;
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('POST /works/:id/fandom-import', () => {
  it('成功：解析条目 → 世界书创建 → work.worldbookIds 绑定', async () => {
    fetchMock.mockResolvedValue(okResp(OK_JSON));
    const h = await loginHeader();
    const res = await request(app).post(`/works/${WID}/fandom-import`).set('Cookie', h).send({ source: '诡秘之主' });
    expect(res.status).toBe(200);
    expect(res.body.entryCount).toBe(2);
    expect(res.body.titles[0]).toContain('主要人物');
    // 世界书文件落盘（constant 条目）
    const wb = (await readJson<{ id: string; name: string; raw: { entries: Record<string, { constant: boolean }> } }>(
      libraryDir('worldbooks') + `/${res.body.worldbookId}.json`,
    ))!;
    expect(wb!.name).toContain('诡秘之主');
    expect(Object.values(wb.raw.entries).every((e) => e.constant)).toBe(true);
    // work 绑定
    const work = (await readJson<Work>(workFile(WID)))!;
    expect(work.worldbookIds).toContain(res.body.worldbookId);
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(sentBody.tools?.[0]?.name).toBe('web_search'); // 联网工具开启
    expect(sentBody.messages.some((m: { content: string }) => String(m.content).includes('诡秘之主'))).toBe(true);
  });

  it('非 fanfic 书 → 400 拒绝且不调 LLM', async () => {
    await writeJsonAtomic(workFile(WID), workFixture('hunhe'));
    const h = await loginHeader();
    const res = await request(app).post(`/works/${WID}/fandom-import`).set('Cookie', h).send({ source: '某原著' });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('LLM 输出不可解析 → 502（不落世界书）', async () => {
    fetchMock.mockResolvedValue(okResp('这不是 JSON 的自由发挥文本')); // end_turn 但非 JSON → 解析 502
    const h = await loginHeader();
    const res = await request(app).post(`/works/${WID}/fandom-import`).set('Cookie', h).send({ source: '某原著' });
    expect(res.status).toBe(502);
  });

  it('对象包裹 {entries:[…]} 形态同样解析（容错）', async () => {
    fetchMock.mockResolvedValue(okResp(`以下为整理结果：\n\n${'`'.repeat(3)}json\n{"entries": ${OK_JSON}}\n${'`'.repeat(3)}`));
    const h = await loginHeader();
    const res = await request(app).post(`/works/${WID}/fandom-import`).set('Cookie', h).send({ source: '某原著' });
    expect(res.status).toBe(200);
    expect(res.body.entryCount).toBe(2);
  });
});
