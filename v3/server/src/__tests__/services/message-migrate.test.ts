/**
 * 存量消息版本迁移测试（安卓 app Phase1）：
 * - string[] 旧数据 → 结构化 MessageVersion[]（v1… 命名）并原子写回
 * - 已结构化数据零写回（幂等，重跑不变）
 * - 空目录/无消息文件零值返回
 * 用 mkdtemp 临时目录，不触真实 data/。
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { migrateMessageVersions } from '../../services/message-migrate';

const dirs: string[] = [];

async function makeDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'msg-migrate-'));
  dirs.push(dir);
  return dir;
}

async function seedMessages(dataDir: string, workId: string, lines: unknown[]): Promise<void> {
  await mkdir(join(dataDir, 'works', workId), { recursive: true });
  const body = lines.map((o) => JSON.stringify(o)).join('\n');
  await writeFile(join(dataDir, 'works', workId, 'messages.jsonl'), `${body}\n`, 'utf8');
}

async function readLines(file: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(file, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe('migrateMessageVersions（swipes string[] → 结构化版本）', () => {
  it('旧数据迁移：命名 v1…、origin=ai、createdAt 取消息时间；publishedVersionId 不设', async () => {
    const dataDir = await makeDataDir();
    const msg = {
      id: 'm1',
      role: 'assistant',
      name: '小说家',
      content: '第二版正文',
      createdAt: 1234,
      swipes: ['第一版正文', '第二版正文'],
      swipeId: 1,
      chapter: { index: 1, title: '一章' },
      extra: {},
    };
    await seedMessages(dataDir, 'w1', [msg]);

    const r = await migrateMessageVersions(dataDir);
    expect(r).toEqual({ files: 1, rewritten: 1 });

    const [back] = await readLines(join(dataDir, 'works', 'w1', 'messages.jsonl'));
    const swipes = back.swipes as { id: string; name: string; content: string; origin: string; createdAt: number }[];
    expect(swipes.map((v) => ({ name: v.name, content: v.content, origin: v.origin, createdAt: v.createdAt }))).toEqual([
      { name: 'v1', content: '第一版正文', origin: 'ai', createdAt: 1234 },
      { name: 'v2', content: '第二版正文', origin: 'ai', createdAt: 1234 },
    ]);
    expect(back.content).toBe('第二版正文'); // content/swipeId 等其余字段原样保留
  });

  it('幂等：已结构化的文件不重写（rewritten=0，磁盘字节不变）', async () => {
    const dataDir = await makeDataDir();
    const line = JSON.stringify({
      id: 'm1',
      role: 'assistant',
      name: '小说家',
      content: '正文',
      createdAt: 1,
      swipes: [{ id: 'v-1', name: 'v1', content: '正文', origin: 'ai', createdAt: 1 }],
      swipeId: 0,
      extra: {},
    });
    await mkdir(join(dataDir, 'works', 'w1'), { recursive: true });
    await writeFile(join(dataDir, 'works', 'w1', 'messages.jsonl'), `${line}\n`, 'utf8');

    const r = await migrateMessageVersions(dataDir);
    expect(r).toEqual({ files: 1, rewritten: 0 });
    expect(await readFile(join(dataDir, 'works', 'w1', 'messages.jsonl'), 'utf8')).toBe(`${line}\n`);
  });

  it('works 目录不存在（全新部署）→ 零值；空 messages 文件不计入 files', async () => {
    const dataDir = await makeDataDir();
    expect(await migrateMessageVersions(dataDir)).toEqual({ files: 0, rewritten: 0 });

    await mkdir(join(dataDir, 'works', 'w-empty'), { recursive: true });
    await writeFile(join(dataDir, 'works', 'w-empty', 'messages.jsonl'), '', 'utf8');
    expect(await migrateMessageVersions(dataDir)).toEqual({ files: 0, rewritten: 0 });
  });
});
