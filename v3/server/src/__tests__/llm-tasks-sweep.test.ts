/**
 * 滞留任务启动清扫测试（sweepInterruptedTasks——main.ts 启动调用）：
 * server 重启后 pending/running 必无执行者（单进程设计零误判）→ 统一标 failed 可重试；
 * 否则滞留任务永久占用同书互斥。终态文件不动。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sweepInterruptedTasks } from '../routes/llm/tasks';
import { llmTasksDir } from '../routes/llm/tasksNovel';
import { readJson, writeJsonAtomic } from '../storage/store';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-llm-sweep-'));
  process.env.DATA_DIR = root; // llmTasksDir 实时读 env——清扫与断言落同一临时目录
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function seedPath(id: string): string {
  return join(llmTasksDir(), `${id}.json`);
}

describe('滞留任务启动清扫', () => {
  it('pending/running → failed（人话 error，progress/messages 清理），done 文件不动；返回清扫数', async () => {
    await writeJsonAtomic(
      seedPath('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'pending', kind: 'novel-chapter',
        workId: 'w-sweep', createdAt: 1, cancelRequested: true,
        progress: { chapterIndex: 2, chapterTotal: 5, phase: 'generating', text: '半章', done: 1, updatedAt: 1 },
      },
    );
    await writeJsonAtomic(
      seedPath('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'running', createdAt: 2,
        messages: [{ role: 'user', content: '隐私输入' }], params: { max_tokens: 100 },
      },
    );
    await writeJsonAtomic(
      seedPath('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'done', text: '成品', createdAt: 3 },
    );

    const swept = await sweepInterruptedTasks();
    expect(swept).toBe(2);

    const a = await readJson<Record<string, unknown>>(seedPath('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    expect(a?.status).toBe('failed');
    expect(a?.error).toBe('服务重启中断，请重新提交');
    expect(a?.progress).toBeUndefined(); // 终态清执行期增量
    expect(a?.workId).toBe('w-sweep'); // 提交参数保留（可复查）
    expect(a?.cancelRequested).toBe(true); // 已有标志不动

    const b = await readJson<Record<string, unknown>>(seedPath('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    expect(b?.status).toBe('failed');
    expect(b?.error).toBe('服务重启中断，请重新提交');
    expect(b?.messages).toBeUndefined(); // 隐私不落盘二份（与终态写同规）
    expect(b?.params).toBeUndefined();

    const c = await readJson<Record<string, unknown>>(seedPath('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    expect(c?.status).toBe('done'); // 终态文件不动
    expect(c?.text).toBe('成品');
    expect(c?.error).toBeUndefined();
  });

  it('空目录 / 已全终态 → 返回 0（幂等可重复调用）', async () => {
    expect(await sweepInterruptedTasks()).toBe(0);
    await writeJsonAtomic(
      seedPath('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'failed', error: 'x', createdAt: 4 },
    );
    expect(await sweepInterruptedTasks()).toBe(0); // failed 不算滞留
  });
});
