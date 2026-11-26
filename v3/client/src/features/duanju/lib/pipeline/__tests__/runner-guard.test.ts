/**
 * 流水线的保护性回归（2026-11-26 独立评审逐条复现过的问题）：
 * 运行期间用户写的内容不被覆盖、每步之后停止都生效、404 不当成「还在跑」、
 * 「只写剧本」进了断点、提交级失败不当成逐集失败、保存失败重试不重新生成、停靠与停止、启动即失败、损坏断点。
 * 夹具与 mock 方式同 runner.test.ts。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
  getPrefs: (): { source: string; model: string } => ({ source: 'claude', model: 'test-model' }),
}));

vi.mock('../../../../../api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('../../../../../stores/settings', () => ({
  useSettingsStore: { getState: () => ({ llmPrefs: mocks.getPrefs() }) },
}));

import { pollBgTask, runBgTask } from '../bgTask';
import { readCheckpoint, writeCheckpoint } from '../checkpoint';
import { resumePipeline, startPipeline, stopPipeline } from '../runner';
import { usePipelineStore } from '../stores';
import { createFakeBackend, speedUpPolling } from './helpers/fakeBackend';
import {
  CHAR_LABEL,
  CHARACTERS_JSON,
  SCENE_LABEL,
  SCENES_JSON,
  SHOTS_JSON,
  WORK,
  adaptLabel,
  episode,
  existingShot,
  novelProject,
  scriptText,
  shotLabel,
} from './helpers/fixtures';

speedUpPolling();
const backend = createFakeBackend();

const labels = (): string[] => backend.labels();
const runMessage = (): string => usePipelineStore.getState().runOf(WORK)?.message ?? '';
/** 用户在流水线运行期间给第 n 集保存了剧本（直接改假后端的作品，相当于用户在剧本 tab 点了保存） */
const userWritesEpisode = (n: number): void => {
  backend.project = {
    ...backend.project,
    revision: backend.project.revision + 1,
    episodes: backend.project.episodes.map((e) =>
      e.index === n ? { ...e, script: `用户写的第 ${n} 集剧本。`, scriptSource: 'manual' as const, scriptUpdatedAt: 99 } : e,
    ),
  };
};
const withScripts = (): ReturnType<typeof novelProject> =>
  novelProject({
    episodes: [1, 2, 3].map((n) => episode(n, { script: scriptText(n), scriptSource: 'adapted', scriptUpdatedAt: 5 })),
  });
/** 给这几集的改编任务排上合格的结果（没排过的任务假后端回 'OK'，会被判成「剧本过短」） */
const adaptOk = (...ns: number[]): void => {
  for (const n of ns) backend.enqueue(adaptLabel(n), { status: 'done', text: scriptText(n) });
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })),
  );
  localStorage.clear();
  usePipelineStore.setState({ runs: {} });
  backend.reset(novelProject());
  backend.onPoll = null;
  mocks.apiFetch.mockImplementation(backend.apiFetch);
  mocks.getPrefs = () => backend.prefs;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('已有内容不覆盖：以写入那一刻的数据为准', () => {
  it('剧本：第 2 集还在生成时用户保存了第 3 集 → 第 3 集不再改编，用户的剧本原样保留', async () => {
    adaptOk(1, 2, 3);
    backend.onPoll = (_id, body) => {
      if (body.label === adaptLabel(2)) userWritesEpisode(3);
    };
    const out = await startPipeline(WORK, { fromStep: 'script', onlyScript: true });
    expect(out?.status).toBe('done');
    expect(labels()).toEqual([adaptLabel(1), adaptLabel(2)]); // 第 3 集轮到时重读作品，发现已有剧本
    expect(backend.project.episodes[2]).toMatchObject({ script: '用户写的第 3 集剧本。', scriptSource: 'manual' });
  });

  it('拆镜头：第 2 集还在拆时用户给第 3 集手动加了镜头 → 第 3 集不拆，用户的镜头不被整集替换', async () => {
    backend.reset(withScripts());
    for (const n of [1, 2, 3]) backend.enqueue(shotLabel(n), { status: 'done', text: SHOTS_JSON });
    backend.onPoll = (_id, body) => {
      if (body.label === shotLabel(2)) {
        backend.project = { ...backend.project, revision: backend.project.revision + 1, shots: [existingShot('ep-3')] };
      }
    };
    await startPipeline(WORK, { fromStep: 'storyboard' });
    expect(labels()).toEqual([shotLabel(1), shotLabel(2)]);
    expect(backend.project.shots.filter((s) => s.episodeId === 'ep-3').map((s) => s.id)).toEqual(['shot-old-ep-3']);
  });

  it('拆镜头：读完作品、提交写入之间用户加了镜头（撞版本冲突后重读）→ 不覆盖', async () => {
    backend.reset(withScripts());
    backend.enqueue(shotLabel(1), { status: 'done', text: SHOTS_JSON });
    let patched = false;
    mocks.apiFetch.mockImplementation(async (path, init) => {
      if (init?.method === 'PATCH' && !patched) {
        patched = true; // 第一次写入前用户抢先加了镜头
        backend.project = { ...backend.project, revision: backend.project.revision + 1, shots: [existingShot('ep-1')] };
      }
      return backend.apiFetch(path, init);
    });
    await startPipeline(WORK, { fromStep: 'storyboard' });
    expect(patched).toBe(true);
    expect(backend.project.shots.filter((s) => s.episodeId === 'ep-1').map((s) => s.id)).toEqual(['shot-old-ep-1']);
  });
});

describe('停止：每一步跑完都生效', () => {
  it('提取角色档案进行中点停止 → 跑完这一步就停，不再发起场景提取，断点不残留', async () => {
    backend.enqueue(CHAR_LABEL, { status: 'done', text: CHARACTERS_JSON });
    backend.onPoll = (_id, body) => {
      if (body.label === CHAR_LABEL) stopPipeline(WORK);
    };
    const out = await startPipeline(WORK);
    expect(out?.status).toBe('stopped');
    expect(labels()).toEqual([CHAR_LABEL]);
    expect(readCheckpoint(WORK)).toBeNull(); // 关页后不会自己从场景步骤续跑
  });

  it('停靠开关打开时，最后一集生成期间点停止 → 是「停止」，不是进入停靠', async () => {
    backend.reset(novelProject({ pipeline: { pauseAfterScripts: true } }));
    backend.onPoll = (_id, body) => {
      if (body.label === adaptLabel(3)) stopPipeline(WORK);
    };
    const out = await startPipeline(WORK, { fromStep: 'script' });
    expect(out?.status).toBe('stopped');
    expect(readCheckpoint(WORK)).toBeNull();
  });
});

describe('断点', () => {
  it('「只写剧本」写进断点；带着它续跑时写完剧本就停，不会接着拆镜头', async () => {
    adaptOk(1, 2, 3);
    backend.onPoll = (_id, body) => {
      if (body.label === adaptLabel(1)) expect(readCheckpoint(WORK)).toMatchObject({ step: 'script', onlyScript: true });
    };
    await startPipeline(WORK, { fromStep: 'script', onlyScript: true });
    expect(labels().some((l) => l.startsWith('流水线·拆镜头'))).toBe(false);

    backend.reset(novelProject({ episodes: [episode(1, { script: scriptText(1), scriptSource: 'adapted', scriptUpdatedAt: 5 }), episode(2), episode(3)] }));
    adaptOk(2, 3);
    writeCheckpoint({ workId: WORK, step: 'script', cursor: 2, failed: [], onlyScript: true, updatedAt: Date.now() });
    const resumed = await resumePipeline(WORK);
    expect(resumed?.status).toBe('done');
    expect(labels()).toEqual([adaptLabel(2), adaptLabel(3)]);
  });

  it('断点里的在途任务已不存在（服务端 404）→ 立刻重提，不空转', async () => {
    backend.enqueue(CHAR_LABEL, { status: 'done', text: CHARACTERS_JSON });
    backend.enqueue(SCENE_LABEL, { status: 'done', text: SCENES_JSON });
    writeCheckpoint({ workId: WORK, step: 'character', cursor: 1, taskId: 't-gone', failed: [], updatedAt: Date.now() });
    await resumePipeline(WORK);
    expect(labels().slice(0, 2)).toEqual([CHAR_LABEL, SCENE_LABEL]); // t-gone 查不到 → 重提角色任务，然后照常往下走
  });

  it('断点 JSON 损坏 → 当作没有并清除，打开作品不抛错', async () => {
    localStorage.setItem(`duanju-pipeline-${WORK}`, '{not json');
    expect(() => readCheckpoint(WORK)).not.toThrow();
    expect(readCheckpoint(WORK)).toBeNull();
    expect(localStorage.getItem(`duanju-pipeline-${WORK}`)).toBeNull();
    expect(await resumePipeline(WORK)).toBeNull();
  });
});

describe('失败的处理', () => {
  it('提交任务都失败（断网 / 额度用尽）→ 停下来并保留断点，不把剩下的集逐个记成失败', async () => {
    mocks.apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/llm/tasks' && init?.method === 'POST') throw Object.assign(new Error('无法连接服务器，请检查网络'), { status: 0 });
      return backend.apiFetch(path, init);
    });
    const out = await startPipeline(WORK, { fromStep: 'script' });
    expect(out).toEqual({ status: 'failed', failed: [] });
    expect(readCheckpoint(WORK)).toMatchObject({ step: 'script', cursor: 1 });
    expect(runMessage()).toContain('可重试');
  });

  it('生成成功但保存失败 → 保留断点；重试时直接取回那份结果，不重新生成', async () => {
    backend.reset(novelProject({ episodes: [episode(1)] }));
    adaptOk(1);
    let broke = true;
    mocks.apiFetch.mockImplementation(async (path, init) => {
      if (init?.method === 'PATCH' && broke) {
        broke = false;
        throw Object.assign(new Error('写入失败'), { status: 500 });
      }
      return backend.apiFetch(path, init);
    });
    const first = await startPipeline(WORK, { fromStep: 'script', onlyScript: true });
    expect(first?.status).toBe('failed');
    expect(backend.project.episodes[0]!.script).toBeUndefined();
    expect(readCheckpoint(WORK)).toMatchObject({ step: 'script', cursor: 1, taskId: expect.any(String) });

    expect((await resumePipeline(WORK))?.status).toBe('done');
    expect(labels()).toEqual([adaptLabel(1)]); // 只提交过一次
    expect(backend.project.episodes[0]!.script).toBe(scriptText(1));
  });

  it('模型连续两次没给出剧本 → 只把这一集记失败，其余照常（单集失败不中断）', async () => {
    adaptOk(1, 3);
    backend.setReplies(adaptLabel(2), [
      { status: 'failed', error: '上游超时' },
      { status: 'failed', error: '上游超时' },
    ]);
    const out = await startPipeline(WORK, { fromStep: 'script', onlyScript: true });
    expect(out?.status).toBe('done');
    expect(out?.failed).toEqual([{ step: 'script', index: 2, reason: '上游超时' }]);
  });

  it('启动就失败（没选模型）→ 状态是失败、没有断点、提示不写「可重试」', async () => {
    backend.prefs = { source: '', model: '' };
    const out = await startPipeline(WORK);
    expect(out?.status).toBe('failed');
    expect(readCheckpoint(WORK)).toBeNull();
    expect(runMessage()).not.toContain('可重试');
  });
});

describe('后台任务：404 不是网络抖动', () => {
  it('轮询一个已不存在的任务：立刻报「已不存在」，不空转满次数', async () => {
    const onPoll = vi.fn();
    await expect(pollBgTask('nope', { maxPolls: 50, onPoll })).rejects.toThrow('已不存在');
    expect(onPoll).not.toHaveBeenCalled();
  });

  it('断点里的任务已不存在：重提新任务并返回它的结果；只是网络抖动则照常等', async () => {
    const text = await runBgTask({ source: 'claude', model: 'm', messages: [], label: '重提' }, { existingTaskId: 't-gone' });
    expect(text).toBe('OK');
    expect(labels()).toEqual(['重提']);

    let flaky = true;
    mocks.apiFetch.mockImplementation(async (path, init) => {
      if (path === '/api/llm/tasks/t-alive' && flaky) {
        flaky = false;
        throw Object.assign(new Error('无法连接服务器，请检查网络'), { status: 0 });
      }
      return backend.apiFetch(path, init);
    });
    backend.putTask('t-alive', { status: 'done', text: '后来有了' });
    expect(await runBgTask({ source: 'claude', model: 'm', messages: [], label: '不该重提' }, { existingTaskId: 't-alive' })).toBe('后来有了');
    expect(labels()).toEqual(['重提']);
  });
});
