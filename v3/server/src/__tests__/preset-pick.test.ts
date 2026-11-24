/**
 * AI 预选主预设条目端点测试（用户需求 2026-11-24：「AI 先根据要求预选好，人工调整」）。
 * collectWithDefense mock（LLM 不实调）——验证 picks 解析、identifier 编造丢弃、单选组语义、
 * 非 fanfic 不开联网、fanfic 开联网、无分组 400。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authRequired, signToken } from '../middleware/auth';
import { HttpError } from '../middleware/validate';
import { readJson, writeJsonAtomic } from '../storage/store';
import { defaultNovelSettings, type Work } from '@shared/work';

const collectMock = vi.fn();
vi.mock('../services/llm/defense', () => ({
  collectWithDefense: (...args: unknown[]) => collectMock(...args),
}));

const { presetPickRouter } = await import('../routes/works/preset-pick');
const { worksDir, workFile } = await import('../routes/works/works');

let root = '';
let app: Express;
const WID = 'w-pick-1';
const PID = 'preset-sudachi-like';

type Row = [identifier: string, name: string, content: string, enabled?: boolean];
const ROWS: Row[] = [
  ['main', '🐳主提示', 'MAIN', true],
  ['h-style', '—\\📖文风设定===', '{{//单选}}', true],
  ['n-light', '🔖N-轻小说', '<writing_style>日系轻小说</writing_style>', true],
  ['drama', '🔥短剧式', '{{setvar::style::短剧式}}', false],
  ['h-tone', '—\\🕰情感基调===', '<keynote>情感基调</keynote>', true],
  ['tone-general', '⚫通用', '<tone>自然平衡</tone>', true],
  ['tone-joy', '⚫欢快', '<tone>欢快明亮</tone>', false],
  ['h-addon', '--\\📌附加选项===', '{{//可多选}}', true],
  ['vivid', '🍈生动化', '<vivid/>', false],
];

function workFixture(genre: string, fandom?: { source: string }): Work {
  return {
    id: WID,
    revision: 1,
    title: 'AI 预选测试书',
    mode: 'novel',
    genre,
    characterIds: [],
    worldbookIds: [],
    presetId: PID,
    regexScriptIds: [],
    settings: {
      ...defaultNovelSettings,
      storyTones: ['温情治愈'],
      ...(genre === 'fanfic' && fandom
        ? { fandomSource: fandom.source, fandomNotes: '兄妹主线不变', writingStyle: 'default' }
        : {}),
    },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  } as Work;
}

const OK_JSON = JSON.stringify({
  picks: [
    { identifier: 'drama', reason: '短剧式循环叙事契合反转剧情' },
    { identifier: 'tone-joy', reason: '轻快的兄妹斗嘴' },
    { identifier: 'tone-general', reason: '整体保持自然' },
    { identifier: 'made-up-id', reason: '编造的条目应被丢弃' },
  ],
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-preset-pick-'));
  process.env.DATA_DIR = root;
  collectMock.mockReset();
  await writeJsonAtomic(join(root, 'presets', `${PID}.json`), {
    id: PID, name: 'Sudachi 类预设',
    raw: {
      prompts: ROWS.map(([identifier, name, content]) =>
        identifier === 'chatHistory'
          ? { identifier, marker: true }
          : { identifier, name, role: 'system', content, system_prompt: true },
      ),
      prompt_order: [{ character_id: 100001, order: ROWS.map(([identifier, , , enabled]) => ({ identifier, enabled: enabled ?? false })) }],
    },
  });
  const authed = (req: Request, _res: Response, next: NextFunction): void => {
    (req as Request & { auth?: unknown }).auth = { role: 'author', uid: 'pt' };
    next();
  };
  const testError = (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  };
  app = express();
  app.use(express.json());
  app.use(authed);
  app.use('/works/:id', presetPickRouter);
  app.use(testError);
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('POST /works/:id/preset-pick（AI 预选）', () => {
  it('成功：返回覆盖草稿 + 理由；编造 identifier 丢弃；单选组语义补齐（未写的关闭）；不开联网（非同人）', async () => {
    await writeJsonAtomic(workFile(WID), workFixture('hunhe'));
    collectMock.mockResolvedValue({ text: OK_JSON, finish: 'stop', lastErr: '' });
    const res = await request(app).post(`/works/${WID}/preset-pick`).send({});
    console.log('DIAG:', res.status, res.text?.slice(0, 200));
    expect(res.status).toBe(200);
    expect(res.body.overrides).toEqual({ drama: true, 'n-light': false, 'tone-general': true, 'tone-joy': true });
    // 单选组：drama 选中 → 预设默认开启的 n-light 补齐关闭；基调组多选并存（用户裁决）
    expect(res.body.reasons.drama).toContain('短剧式');
    expect(res.body.overrides['made-up-id']).toBeUndefined();
    expect(collectMock.mock.calls[0]![0].params.webSearchUses).toBe(0); // 非同人不开联网（显式 0）
  });

  it('fanfic + 原著信息 → 开联网搜索（webSearchUses=2）', async () => {
    await writeJsonAtomic(workFile(WID), workFixture('fanfic', { source: '诡秘之主' }));
    collectMock.mockResolvedValue({ text: OK_JSON, finish: 'stop', lastErr: '' });
    await request(app).post(`/works/${WID}/preset-pick`).send({});
    expect(collectMock.mock.calls[0]![0].params.webSearchUses).toBe(2);
  });

  it('LLM 输出不可解析 → 502', async () => {
    await writeJsonAtomic(workFile(WID), workFixture('hunhe'));
    collectMock.mockResolvedValue({ text: '不是 JSON', finish: 'stop', lastErr: '' });
    const res = await request(app).post(`/works/${WID}/preset-pick`).send({});
    expect(res.status).toBe(502);
  });

  it('无分组主预设 → 400', async () => {
    await writeJsonAtomic(join(root, 'presets', `${PID}.json`), {
      id: PID, name: 'plain',
      raw: { prompts: [{ identifier: 'main', name: 'Main', content: 'x', system_prompt: true }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }] },
    });
    await writeJsonAtomic(workFile(WID), workFixture('hunhe'));
    const res = await request(app).post(`/works/${WID}/preset-pick`).send({});
    expect(res.status).toBe(400);
  });
});
