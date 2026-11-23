/**
 * 角色卡同名幂等 + 空卡自愈测试（生产 65 张空卡案例：早期建卡路径只写名字，
 * 后续完整导入被幂等挡回永远填不上——upgradeEmptyByName 让空卡在下次导入时被填上）
 */
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { charactersRouter } from '../routes/library/characters';
import { readJson, writeJsonAtomic } from '../storage/store';

let root = '';
let app: express.Express;
const NAME = '陆骁';

const fullCard = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: { name: NAME, description: '冷面刀客，外冷内热；背负血仇。', personality: '沉稳' },
};
const emptyCard = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: { name: NAME, description: '' },
};

async function seedCharacter(body: Record<string, unknown>): Promise<void> {
  await writeJsonAtomic(join(root, 'characters', 'seed.json'), {
    id: 'seed',
    createdAt: Date.now(),
    ...body,
  } as unknown as Record<string, unknown>);
}

async function readSeed(): Promise<Record<string, unknown> & { card?: { data?: { description?: string } } }> {
  return (await readJson(join(root, 'characters', 'seed.json')))!;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-charupgrade-'));
  process.env.DATA_DIR = root;
  const authed = (req: Request, _res: Response, next: NextFunction): void => {
    (req as Request & { auth?: unknown }).auth = { role: 'author', uid: 'pt' };
    next();
  };
  const a = express();
  a.use(express.json());
  a.use(authed);
  a.use('/characters', charactersRouter);
  app = a;
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('角色卡同名幂等 + 空卡自愈（upgradeEmptyByName）', () => {
  it('空卡 + 完整新卡 → 升级覆盖（card 有内容，id/origin/bio 保留）', async () => {
    await seedCharacter({ name: NAME, card: emptyCard, origin: 'w1', bio: '作者手写小传' });
    const res = await request(app).post('/characters').send({ name: NAME, card: fullCard });
    expect(res.status).toBe(200);
    expect(res.body.card.data.description).toContain('冷面刀客'); // 升级
    const seeded = await readSeed();
    expect(seeded.card?.data?.description).toContain('冷面刀客'); // 落盘
    expect(seeded.origin).toBe('w1'); // 归属保留
    expect(seeded.bio).toBe('作者手写小传'); // 小传保留
  });

  it('非空卡 + 完整新卡 → 幂等命中返回旧卡，不覆盖（作者编辑不被导入冲掉）', async () => {
    await seedCharacter({ name: NAME, card: fullCard });
    const res = await request(app).post('/characters').send({ name: NAME, card: emptyCard });
    expect(res.status).toBe(200);
    expect(res.body.card.data.description).toContain('冷面刀客'); // 旧卡原样返回
    const seeded = await readSeed();
    expect(seeded.card?.data?.description).toContain('冷面刀客');
  });

  it('空卡 + 空新卡 → 返回旧卡（无从升级）', async () => {
    await seedCharacter({ name: NAME, card: emptyCard });
    const res = await request(app).post('/characters').send({ name: NAME, card: emptyCard });
    expect(res.status).toBe(200);
    expect(res.body.card.data.description).toBe('');
  });

  it('磁盘校验：升级后文件内 description 落盘（readFile 直读）', async () => {
    await seedCharacter({ name: NAME, card: emptyCard });
    await request(app).post('/characters').send({ name: NAME, card: fullCard });
    const raw = await readFile(join(root, 'characters', 'seed.json'), 'utf8');
    expect(raw).toContain('冷面刀客');
  });
});
