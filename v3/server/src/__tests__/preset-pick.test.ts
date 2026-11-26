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

const { presetPickRouter, presetPickPreviewRouter } = await import('../routes/works/preset-pick');
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
  app.use('/works', presetPickPreviewRouter);
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

describe('POST /works/preset-pick-preview（建书弹窗：书还没建，书籍信息内联）', () => {
  /** 断言请求体里要求的基调 / 风格原样进了给 LLM 的书籍信息 */
  const promptOf = (): string => collectMock.mock.calls[0]![0].messages[1]!.content;

  it('不读 work：内联信息直送 LLM；编造 id 丢弃、单选组语义补齐', async () => {
    collectMock.mockResolvedValue({ text: OK_JSON, finish: 'stop', lastErr: '' });
    const res = await request(app).post('/works/preset-pick-preview').send({
      presetId: PID,
      title: '走查新书',
      genre: 'moshi',
      storyTones: ['温情治愈'],
      customStoryTone: '轻松欢快',
      writingStyle: 'fanqie',
    });
    expect(res.status).toBe(200);
    expect(res.body.overrides).toEqual({ drama: true, 'n-light': false, 'tone-general': true, 'tone-joy': true });
    expect(res.body.overrides['made-up-id']).toBeUndefined();
    const prompt = promptOf();
    expect(prompt).toContain('温情治愈');
    expect(prompt).toContain('轻松欢快');
    expect(prompt).toContain('番茄·快节奏'); // 内置风格键 → 中文标签
    // 书还没建：DATA_DIR 里没有 works 目录也不影响（此前端点必须先 readWork）
  });

  it('presetId 缺失 → 400；资产不存在 → 400', async () => {
    const noPreset = await request(app).post('/works/preset-pick-preview').send({ genre: 'moshi' });
    expect(noPreset.status).toBe(400);
    const ghost = await request(app)
      .post('/works/preset-pick-preview')
      .send({ presetId: 'ghost-preset', genre: 'moshi' });
    expect(ghost.status).toBe(400);
    expect(ghost.body.error).toContain('主预设资产不存在');
  });

  it('只有 other 组（无文风/基调/附加）→ 400', async () => {
    await writeJsonAtomic(join(root, 'presets', `${PID}.json`), {
      id: PID, name: 'plain-other',
      raw: {
        prompts: [
          { identifier: 'h-regular', name: '—\\⚙常规设定===', content: '', system_prompt: true },
          { identifier: 'num', name: '🔢字数设定', content: 'x', system_prompt: true },
        ],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'h-regular', enabled: true }, { identifier: 'num', enabled: true }] }],
      },
    });
    const res = await request(app).post('/works/preset-pick-preview').send({ presetId: PID, genre: 'moshi' });
    expect(res.status).toBe(400);
  });
});
