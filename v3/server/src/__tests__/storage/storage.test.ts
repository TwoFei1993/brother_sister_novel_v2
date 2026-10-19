// 存储层测试：原子写（store.ts）、JSONL 读写（jsonl.ts）、per-work 写队列（writer.ts）。
// 全部操作在 os.tmpdir() 下随机临时目录进行，结束后整目录清理。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withWorkLock } from '../../middleware/writer';
import { ensureDir, readJson, writeJsonAtomic } from '../../storage/store';
import {
  appendLine,
  readAll,
  readBefore,
  readSince,
  readTail,
  readWindow,
  rewriteAll,
} from '../../storage/jsonl';

/** JSONL 行的测试样本类型（满足 T extends { id: string }） */
type Line = { id: string; text: string };

const delay = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 5 条固定消息：m1..m5 */
const makeMsgs = (): Line[] =>
  ['m1', 'm2', 'm3', 'm4', 'm5'].map((id, i) => ({ id, text: `第${i + 1}条` }));

let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-storage-'));
  // 预填一个 5 条消息的 jsonl，供游标读取类测试共用
  const flow = join(root, 'flow.jsonl');
  for (const m of makeMsgs()) await appendLine(flow, m);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('withWorkLock 写队列', () => {
  it('同 workId 的操作严格串行执行，无交错', async () => {
    const log: string[] = [];
    const task =
      (name: string, ms: number) =>
      async (): Promise<void> => {
        log.push(`${name}:start`);
        await delay(ms);
        log.push(`${name}:end`);
      };
    const p1 = withWorkLock('serial-work', task('A', 40));
    const p2 = withWorkLock('serial-work', task('B', 10));
    await Promise.all([p1, p2]);
    // B 必须等 A 完全结束后才开始
    expect(log).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
  });

  it('不同 workId 并行执行，互不阻塞', async () => {
    const log: string[] = [];
    const task =
      (name: string, ms: number) =>
      async (): Promise<void> => {
        log.push(`${name}:start`);
        await delay(ms);
        log.push(`${name}:end`);
      };
    const p1 = withWorkLock('work-a', task('A', 60));
    const p2 = withWorkLock('work-b', task('B', 15));
    await Promise.all([p1, p2]);
    // B 的 start 出现在 A 的 end 之前，证明 B 未等 A
    expect(log.indexOf('B:start')).toBeLessThan(log.indexOf('A:end'));
  });

  it('fn 抛错向上传播，且不阻塞同 workId 的后续排队', async () => {
    await expect(
      withWorkLock('err-work', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // 前一任务失败后，队列链不断，后续任务照常执行
    const out = await withWorkLock('err-work', async () => 'ok');
    expect(out).toBe('ok');
  });
});

describe('store.ts 原子写', () => {
  it('writeJsonAtomic 写后读回一致，覆盖写成功且无 .tmp 残留', async () => {
    const dir = join(root, 'atomic');
    await ensureDir(dir);
    const file = join(dir, 'work.json');

    await writeJsonAtomic(file, { id: 'w1', revision: 1, title: '旧' });
    expect(await readJson(file)).toEqual({ id: 'w1', revision: 1, title: '旧' });

    // 覆盖已存在的文件（fs.rename 在 Windows 经 MOVEFILE_REPLACE_EXISTING 可直接覆盖，review #12）
    await writeJsonAtomic(file, { id: 'w1', revision: 2, title: '新' });
    expect(await readJson(file)).toEqual({ id: 'w1', revision: 2, title: '新' });

    // 目录内只剩目标文件本身，无 .tmp 残留
    expect(await readdir(dir)).toEqual(['work.json']);
    // 读取不存在的文件返回 null
    expect(await readJson(join(dir, 'nope.json'))).toBeNull();
  });
});

describe('jsonl.ts 读写', () => {
  it('appendLine 追加多行后 readAll 顺序正确', async () => {
    const file = join(root, 'append.jsonl');
    for (const m of makeMsgs()) await appendLine(file, m);
    const all = await readAll<Line>(file);
    expect(all.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('readTail(n) 返回尾部 n 条', async () => {
    const tail = await readTail<Line>(join(root, 'flow.jsonl'), 2);
    expect(tail.map((m) => m.id)).toEqual(['m4', 'm5']);
  });

  it('readBefore(beforeId, limit) 返回该 id 之前的 limit 条窗口', async () => {
    const before = await readBefore<Line>(join(root, 'flow.jsonl'), 'm4', 2);
    expect(before.map((m) => m.id)).toEqual(['m2', 'm3']);
  });

  it('readWindow before 模式 hasMore：锚点前还有整页时 true，不足一页时 false（Task 20 回归）', async () => {
    const file = join(root, 'flow.jsonl');
    // m3 前有 m1/m2 两行：limit=2 恰好取完 → 更早方向无剩余，hasMore=false
    const exact = await readWindow<Line>(file, { kind: 'before', beforeId: 'm3', limit: 2 });
    expect(exact.hasMore).toBe(false);
    expect(exact.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    // limit=1 只取到 m2 → 前面还有 m1，hasMore=true
    const partial = await readWindow<Line>(file, { kind: 'before', beforeId: 'm3', limit: 1 });
    expect(partial.hasMore).toBe(true);
    expect(partial.messages.map((m) => m.id)).toEqual(['m2']);
  });

  it('readSince(sinceId) 返回该 id 之后的全部增量', async () => {
    const since = await readSince<Line>(join(root, 'flow.jsonl'), 'm3');
    expect(since.map((m) => m.id)).toEqual(['m4', 'm5']);
  });

  it('rewriteAll 整文件重写，旧行被替换', async () => {
    const file = join(root, 'rewrite.jsonl');
    await appendLine(file, { id: 'old-1', text: '旧行一' });
    await appendLine(file, { id: 'old-2', text: '旧行二' });
    await rewriteAll(file, [
      { id: 'm4', text: '第4条' },
      { id: 'm5', text: '第5条' },
    ]);
    const all = await readAll<Line>(file);
    expect(all.map((m) => m.id)).toEqual(['m4', 'm5']);
  });

  it('readBefore 的 beforeId 不存在时返回尾部 limit 条（锁定语义）', async () => {
    const before = await readBefore<Line>(join(root, 'flow.jsonl'), 'no-such-id', 2);
    expect(before.map((m) => m.id)).toEqual(['m4', 'm5']);
  });
});
