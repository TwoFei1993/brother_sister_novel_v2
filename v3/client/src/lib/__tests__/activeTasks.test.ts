/**
 * activeTasks 共享客户端测试（Chunk 6）：GET /active 响应解析 / novel-chapter 按 workId 索引 /
 * phase 中文映射。fetch 模块级 stub，不触网。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchActiveTasks, novelTasksByWork, phaseLabel, type ActiveTask } from '../activeTasks';

function jsonRes(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

function task(partial: Partial<ActiveTask> & Pick<ActiveTask, 'id' | 'kind'>): ActiveTask {
  return { progressLen: 0, done: 0, chapterTotal: 0, createdAt: 1, ...partial };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchActiveTasks', () => {
  it('GET /api/llm/tasks/active 并返回 tasks 列表', async () => {
    const fetchMock = vi.fn(async (path: string) => {
      expect(path).toBe('/api/llm/tasks/active');
      return jsonRes({ tasks: [task({ id: 't1', kind: 'novel-chapter', workId: 'w1' })] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const tasks = await fetchActiveTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].workId).toBe('w1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('响应缺 tasks 字段（异常负载）回落空数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({})));
    expect(await fetchActiveTasks()).toEqual([]);
  });

  it('非 2xx 抛错（轮询方静默重试下一拍）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })));
    await expect(fetchActiveTasks()).rejects.toThrow();
  });
});

describe('novelTasksByWork', () => {
  it('仅索引 novel-chapter 任务（llm 任务无 workId 不入索引）', () => {
    const byWork = novelTasksByWork([
      task({ id: 't1', kind: 'novel-chapter', workId: 'w1', done: 2, chapterTotal: 5, phase: 'generating', progressLen: 1200 }),
      task({ id: 't2', kind: 'llm', label: '大纲' }),
      task({ id: 't3', kind: 'novel-chapter', workId: 'w2' }),
    ]);
    expect(Object.keys(byWork)).toEqual(['w1', 'w2']);
    expect(byWork.w1?.done).toBe(2);
    expect(byWork.w1?.chapterTotal).toBe(5);
    expect(byWork.w1?.phase).toBe('generating');
  });

  it('同书多任务取后者（理论不可能：同书互斥 409，防御性覆盖）', () => {
    const byWork = novelTasksByWork([
      task({ id: 't1', kind: 'novel-chapter', workId: 'w1', done: 1 }),
      task({ id: 't2', kind: 'novel-chapter', workId: 'w1', done: 3 }),
    ]);
    expect(byWork.w1?.id).toBe('t2');
  });
});

describe('phaseLabel', () => {
  it('五种执行相位中文映射', () => {
    expect(phaseLabel('assembling')).toBe('组装中');
    expect(phaseLabel('generating')).toBe('生成中');
    expect(phaseLabel('continuing')).toBe('续写中');
    expect(phaseLabel('polishing')).toBe('润色中');
    expect(phaseLabel('saving')).toBe('入库中');
  });

  it('无相位（任务尚未开始/pending）显示排队中', () => {
    expect(phaseLabel(undefined)).toBe('排队中');
  });
});
