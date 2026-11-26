/**
 * 流水线的停止、续跑、在途任务复用、停靠与步骤级失败（设计共识 2026-11-26 第 3.6 节）。
 * 假后端的装法与 runner.test.ts 相同。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 占位 mock 同步建好（vi.hoisted）；假后端实例在 import 之后创建并装到占位上
//（不要在 vi.mock 工厂里 import 假后端：会和本文件的静态 import 互相等待，把测试进程挂死）
const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
  getPrefs: (): { source: string; model: string } => ({ source: 'claude', model: 'test-model' }),
}));

vi.mock('../../../../../api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('../../../../../stores/settings', () => ({
  useSettingsStore: { getState: () => ({ llmPrefs: mocks.getPrefs() }) },
}));

import { readCheckpoint, writeCheckpoint } from '../checkpoint';
import {
  continuePipeline,
  isPipelineRunning,
  resumePipeline,
  startPipeline,
  stopPipeline,
} from '../runner';
import { usePipelineStore } from '../stores';
import { createFakeBackend, speedUpPolling } from './helpers/fakeBackend';
import {
  CHAR_LABEL,
  CHARACTERS_JSON,
  SCENE_LABEL,
  WORK,
  adaptLabel,
  episode,
  happyPathReplies,
  novelProject,
  scriptText,
  shotLabel,
} from './helpers/fixtures';

speedUpPolling();
const backend = createFakeBackend();
mocks.apiFetch.mockImplementation(backend.apiFetch);
mocks.getPrefs = () => backend.prefs;

const labels = (): string[] => backend.labels();
const happy = (): void => {
  for (const [label, reply] of happyPathReplies(3)) backend.enqueue(label, reply);
};
const run = (): ReturnType<typeof usePipelineStore.getState>['runOf'] extends (w: string) => infer R
  ? R
  : never => usePipelineStore.getState().runOf(WORK);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })),
  );
  localStorage.clear();
  usePipelineStore.setState({ runs: {} });
  backend.reset(novelProject());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('停止', () => {
  it('进行中点停止：当前这一集跑完并落库后停下；断点删除，之后不会自动续跑', async () => {
    happy();
    let stopped = false;
    backend.onPoll = (_taskId, body) => {
      if (body.label === adaptLabel(2) && !stopped) {
        stopped = true;
        stopPipeline(WORK);
      }
    };
    const out = await startPipeline(WORK);
    expect(out?.status).toBe('stopped');
    expect(labels()).toEqual([CHAR_LABEL, SCENE_LABEL, adaptLabel(1), adaptLabel(2)]);
    expect(backend.project.episodes.map((e) => Boolean(e.script))).toEqual([true, true, false]);
    expect(readCheckpoint(WORK)).toBeNull();
    expect(run()?.status).toBe('stopped');
    expect(await resumePipeline(WORK)).toBeNull();
    expect(labels()).toHaveLength(4);
  });

  it('刚启动就点停止：读完作品即停，不提交任何任务', async () => {
    happy();
    const pending = startPipeline(WORK);
    stopPipeline(WORK);
    const out = await pending;
    expect(out?.status).toBe('stopped');
    expect(labels()).toEqual([]);
    expect(readCheckpoint(WORK)).toBeNull();
    expect(isPipelineRunning(WORK)).toBe(false);
  });
});

describe('被动中断后的续跑', () => {
  it('断点里的在途任务已完成 → 直接取结果落库，不重提；随后接着跑后面的集', async () => {
    // 页面被回收时的状态：第 1 集已写完，第 2 集的任务刚提交（服务端已跑完）
    backend.reset(novelProject({ episodes: [episode(1, { script: scriptText(1) }), episode(2), episode(3)] }));
    writeCheckpoint({ workId: WORK, step: 'script', cursor: 2, taskId: 't-existing', failed: [], updatedAt: 1 });
    backend.putTask('t-existing', { status: 'done', text: scriptText(2) });
    happy();
    const out = await resumePipeline(WORK);
    expect(out?.status).toBe('done');
    expect(labels()).toEqual([adaptLabel(3), shotLabel(1), shotLabel(2), shotLabel(3)]); // 没有「改编剧本·第2集」
    expect(backend.project.episodes.map((e) => Boolean(e.script))).toEqual([true, true, true]);
    expect(readCheckpoint(WORK)).toBeNull();
  });

  it('断点里的在途任务已失败 / 丢失 → 重新提交', async () => {
    backend.reset(novelProject({ episodes: [episode(1, { script: scriptText(1) }), episode(2), episode(3)] }));
    writeCheckpoint({ workId: WORK, step: 'script', cursor: 2, taskId: 't-dead', failed: [], updatedAt: 1 });
    backend.putTask('t-dead', { status: 'failed', error: '服务重启中断，请重新提交' });
    happy();
    await resumePipeline(WORK);
    expect(labels()[0]).toBe(adaptLabel(2));
  });

  it('续跑读的是最新数据：中断期间用户手写了某一集 → 该集跳过', async () => {
    backend.reset(
      novelProject({
        episodes: [episode(1, { script: scriptText(1) }), episode(2, { script: '用户手写的第 2 集。'.repeat(20) }), episode(3)],
      }),
    );
    writeCheckpoint({ workId: WORK, step: 'script', cursor: 2, failed: [], updatedAt: 1 });
    happy();
    await resumePipeline(WORK);
    expect(labels()).not.toContain(adaptLabel(2));
    expect(backend.project.episodes[1]!.script).toContain('用户手写的第 2 集');
  });

  it('断点里的失败清单保留到结束并汇总', async () => {
    writeCheckpoint({
      workId: WORK,
      step: 'script',
      cursor: 3,
      failed: [{ step: 'script', index: 2, reason: '上游超时' }],
      updatedAt: 1,
    });
    backend.reset(novelProject({ episodes: [episode(1, { script: scriptText(1) }), episode(2), episode(3)] }));
    happy();
    const out = await resumePipeline(WORK);
    expect(out?.status).toBe('done');
    expect(out?.failed).toEqual([{ step: 'script', index: 2, reason: '上游超时' }]);
    expect(run()?.message).toContain('剧本·第 2 集（上游超时）');
  });

  it('没有断点 → 什么都不做', async () => {
    expect(await resumePipeline(WORK)).toBeNull();
    expect(labels()).toEqual([]);
  });
});

describe('停靠：剧本写完先停下等审', () => {
  function pausedProject(): void {
    backend.reset(novelProject({ pipeline: { pauseAfterScripts: true } }));
  }

  it('剧本写完即停：不提交拆镜头；断点保留并标停靠；打开作品不自动续；点继续后从拆镜头接着跑', async () => {
    pausedProject();
    happy();
    const out = await startPipeline(WORK);
    expect(out?.status).toBe('paused');
    expect(labels()).toEqual([CHAR_LABEL, SCENE_LABEL, adaptLabel(1), adaptLabel(2), adaptLabel(3)]);
    expect(readCheckpoint(WORK)).toMatchObject({ step: 'storyboard', cursor: 1, paused: true });
    expect(run()?.status).toBe('paused');
    expect(run()?.message).toContain('继续拆镜头');

    expect(await resumePipeline(WORK)).toBeNull(); // 打开作品：只恢复提示
    expect(labels()).toHaveLength(5);

    const resumed = await continuePipeline(WORK);
    expect(resumed?.status).toBe('done');
    expect(labels()).toHaveLength(8);
    expect(readCheckpoint(WORK)).toBeNull();
    expect(backend.project.shots).toHaveLength(3);
  });

  it('停靠中点停止 = 放弃这次流水线：断点与提示清除，之后不能继续', async () => {
    pausedProject();
    happy();
    await startPipeline(WORK);
    stopPipeline(WORK);
    expect(readCheckpoint(WORK)).toBeNull();
    expect(run()).toBeUndefined();
    expect(await continuePipeline(WORK)).toBeNull();
  });

  it('停靠开关关着 → 不停靠，直接接着拆镜头', async () => {
    backend.reset(novelProject({ pipeline: { pauseAfterScripts: false } }));
    happy();
    expect((await startPipeline(WORK))?.status).toBe('done');
    expect(labels()).toHaveLength(8);
  });
});

describe('步骤级失败', () => {
  it('角色提取失败 → 中断并保留断点；之后续跑从这一步重试成功', async () => {
    happy();
    backend.setReplies(CHAR_LABEL, [{ status: 'failed', error: '上游超时' }]);
    const out = await startPipeline(WORK);
    expect(out?.status).toBe('failed');
    expect(labels()).toEqual([CHAR_LABEL]);
    expect(readCheckpoint(WORK)).toMatchObject({ workId: WORK, step: 'character' });
    expect(run()?.status).toBe('failed');
    expect(run()?.message).toContain('流水线中断：上游超时');
    expect(isPipelineRunning(WORK)).toBe(false);

    backend.enqueue(CHAR_LABEL, { status: 'done', text: CHARACTERS_JSON });
    const retried = await resumePipeline(WORK);
    expect(retried?.status).toBe('done');
    expect(labels()).toHaveLength(9); // 失败那次 + 完整 8 步
    expect(readCheckpoint(WORK)).toBeNull();
    expect(backend.project.characters).toHaveLength(1);
  });

  it('读作品失败 → 中断，不提交任务', async () => {
    happy();
    mocks.apiFetch.mockRejectedValueOnce(Object.assign(new Error('网络中断'), { status: 0 }));
    const out = await startPipeline(WORK);
    expect(out?.status).toBe('failed');
    expect(labels()).toEqual([]);
    expect(run()?.message).toContain('流水线中断：网络中断');
  });
});
