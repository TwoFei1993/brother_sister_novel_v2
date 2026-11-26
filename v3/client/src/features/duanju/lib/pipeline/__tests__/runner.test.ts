/**
 * 流水线主流程测试（设计共识 2026-11-26 第 3.6 节）：顺序、按集切片、已有内容不覆盖、
 * 单集失败不中断、只写剧本、「只有第 1 集」续写、重入、撞冲突重试。
 * 网络层与设置 store 指向内存假后端（./helpers/fakeBackend，只经 vi.hoisted 的实例访问）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 占位 mock 同步建好（vi.hoisted）；假后端实例在 import 之后创建并装到占位上。
// 不要在 vi.mock 工厂里 import 假后端：会和本文件的静态 import 互相等待，把测试进程挂死。
const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
  getPrefs: (): { source: string; model: string } => ({ source: 'claude', model: 'test-model' }),
}));

vi.mock('../../../../../api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('../../../../../stores/settings', () => ({
  useSettingsStore: { getState: () => ({ llmPrefs: mocks.getPrefs() }) },
}));

import { readCheckpoint } from '../checkpoint';
import { isPipelineRunning, startPipeline } from '../runner';
import { usePipelineStore } from '../stores';
import { createFakeBackend, speedUpPolling } from './helpers/fakeBackend';
import {
  CHAR_LABEL,
  SCENE_LABEL,
  WORK,
  adaptLabel,
  continueLabel,
  episode,
  episode1Project,
  existingCharacter,
  existingScene,
  existingShot,
  happyPathReplies,
  novelProject,
  shotLabel,
} from './helpers/fixtures';

speedUpPolling();
const backend = createFakeBackend();
mocks.apiFetch.mockImplementation(backend.apiFetch);
mocks.getPrefs = () => backend.prefs;

const labels = (): string[] => backend.labels();
const userOf = (label: string, nth = 1): string => backend.bodyOf(label, nth).messages[1]!.content;
const happy = (episodes = 3): void => {
  for (const [label, reply] of happyPathReplies(episodes)) backend.enqueue(label, reply);
};

beforeEach(() => {
  // 叙事机制库（拆镜头时读取的静态 JSON）
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

describe('完整流水线：角色 → 场景 → 分集剧本 → 拆镜头', () => {
  it('按顺序执行；每集剧本落库并各自拆出镜头；结束后断点清除、状态为完成', async () => {
    happy();
    const out = await startPipeline(WORK);
    expect(out).toEqual({ status: 'done', failed: [] });
    expect(labels()).toEqual([
      CHAR_LABEL,
      SCENE_LABEL,
      adaptLabel(1),
      adaptLabel(2),
      adaptLabel(3),
      shotLabel(1),
      shotLabel(2),
      shotLabel(3),
    ]);
    const p = backend.project;
    expect(p.characters.map((c) => c.name)).toEqual(['小明']);
    expect(p.scenes.map((s) => s.name)).toEqual(['家门口']);
    expect(p.episodes.map((e) => e.scriptSource)).toEqual(['adapted', 'adapted', 'adapted']);
    expect(p.episodes.map((e) => e.script?.slice(0, 10))).toEqual([
      '场1 内·地点1·日',
      '场1 内·地点2·日',
      '场1 内·地点3·日',
    ]);
    expect(p.episodes.map((e) => p.shots.filter((s) => s.episodeId === e.id).length)).toEqual([1, 1, 1]);
    // 集的其余字段不丢（锚点）
    expect(p.episodes[1]).toMatchObject({ sourceStart: '第 2 章', sourceEnd: '小明到了。', title: '标题2' });
    expect(readCheckpoint(WORK)).toBeNull();
    expect(usePipelineStore.getState().runOf(WORK)?.status).toBe('done');
    expect(isPipelineRunning(WORK)).toBe(false);
  });

  it('每集改编只拿到本集对应的原文切片，带上一集结尾与下一集梗概；拆镜头读的是本集剧本', async () => {
    happy();
    await startPipeline(WORK);
    expect(backend.bodyOf(adaptLabel(2)).messages[0]!.role).toBe('system');
    const user = userOf(adaptLabel(2));
    expect(user).toContain('第 2 章 到达\n小明到了。');
    expect(user).not.toContain('小明回了家');
    expect(user).toContain('下一集梗概（不要写进去）：第3集梗概');
    expect(user).toContain('- 小明：黑发少年，蓝衣'); // 角色档案在剧本步骤之前已入库
    // 上一集结尾作为第 3 集的开场承接（第 2 集写入后立刻能读到）
    expect(userOf(adaptLabel(3))).toContain('上一集结尾（开场承接它的状态，不复述）：\n…场1 内·地点2·日');
    const shot = userOf(shotLabel(2));
    expect(shot).toContain('这是第2集的正文。');
    expect(shot).not.toContain('这是第1集的正文。');
  });
});

describe('已有内容不覆盖', () => {
  it('角色档案非空不动；场景档案为空才补上；已有剧本的集跳过；已有镜头的集跳过', async () => {
    const userScript = '用户写的第 1 集剧本。'.repeat(20);
    backend.reset(
      novelProject({
        characters: [existingCharacter()],
        scenes: [existingScene({ spec: '' })],
        episodes: [episode(1, { script: userScript }), episode(2), episode(3)],
        shots: [existingShot('ep-3')],
      }),
    );
    happy();
    await startPipeline(WORK);
    // 第 1 集剧本已有 → 不写；第 3 集没剧本 → 照常改编，但它已有镜头 → 不拆
    expect(labels()).toEqual([CHAR_LABEL, SCENE_LABEL, adaptLabel(2), adaptLabel(3), shotLabel(1), shotLabel(2)]);
    const p = backend.project;
    expect(p.characters[0]).toMatchObject({ profile: '用户手调过的档案', updatedAt: 5 });
    expect(p.scenes[0]).toMatchObject({ spec: '木门青瓦，晨光斜照' });
    expect(p.episodes[0]!.script).toBe(userScript);
    expect(p.episodes[0]!.scriptSource).toBeUndefined();
    expect(p.shots.find((s) => s.id === 'shot-old-ep-3')).toBeDefined(); // 旧镜头没被替换
  });

  it('新名字的角色 / 场景追加，不挤掉已有的', async () => {
    backend.reset(novelProject({ characters: [existingCharacter({ name: '路人甲' })] }));
    happy();
    await startPipeline(WORK);
    expect(backend.project.characters.map((c) => c.name)).toEqual(['路人甲', '小明']);
  });
});

describe('单集失败不中断', () => {
  it('某集剧本两次都失败 → 记进失败清单，不拆该集镜头，其余集照常', async () => {
    happy();
    backend.setReplies(adaptLabel(2), [
      { status: 'failed', error: '上游超时' },
      { status: 'failed', error: '上游超时' },
    ]);
    const out = await startPipeline(WORK);
    expect(out?.status).toBe('done');
    expect(out?.failed).toEqual([{ step: 'script', index: 2, reason: '上游超时' }]);
    expect(labels()).toEqual([
      CHAR_LABEL,
      SCENE_LABEL,
      adaptLabel(1),
      adaptLabel(2),
      adaptLabel(2),
      adaptLabel(3),
      shotLabel(1),
      shotLabel(3),
    ]);
    expect(backend.project.episodes[1]!.script).toBeUndefined();
    expect(usePipelineStore.getState().runOf(WORK)?.message).toContain('剧本·第 2 集（上游超时）');
  });

  it('模型给的正文太短 → 重试一次，仍太短按失败处理，不把残稿落库', async () => {
    happy();
    backend.setReplies(adaptLabel(3), [
      { status: 'done', text: '场1 内·家门口·日\n太短的正文' },
      { status: 'done', text: '场1 内·家门口·日\n还是太短' },
    ]);
    const out = await startPipeline(WORK);
    expect(out?.failed[0]).toMatchObject({ step: 'script', index: 3 });
    expect(out?.failed[0]!.reason).toContain('剧本过短');
    expect(backend.project.episodes[2]!.script).toBeUndefined();
  });

  it('没有本集梗概 → 不调模型，直接记失败', async () => {
    backend.reset(novelProject({ episodes: [episode(1), episode(2, { synopsis: '  ' }), episode(3)] }));
    happy();
    const out = await startPipeline(WORK);
    expect(labels()).not.toContain(adaptLabel(2));
    expect(out?.failed).toEqual([{ step: 'script', index: 2, reason: '没有本集梗概' }]);
  });

  it('某集拆镜头失败 → 记进失败清单，后面的集照常拆', async () => {
    happy();
    backend.setReplies(shotLabel(2), [{ status: 'failed', error: '上游 500' }]);
    const out = await startPipeline(WORK);
    expect(out?.failed).toEqual([{ step: 'storyboard', index: 2, reason: '上游 500' }]);
    expect(backend.project.shots.map((s) => s.episodeId)).toEqual(['ep-1', 'ep-3']);
  });
});

describe('启动方式', () => {
  it('只写剧本（剧本 tab 的「一键改编全部未写集」）：剧本写完即停，不提取档案也不拆镜头', async () => {
    happy();
    const out = await startPipeline(WORK, { fromStep: 'script', onlyScript: true });
    expect(out?.status).toBe('done');
    expect(labels()).toEqual([adaptLabel(1), adaptLabel(2), adaptLabel(3)]);
    expect(backend.project.shots).toEqual([]);
    expect(readCheckpoint(WORK)).toBeNull();
  });

  it('「只有第 1 集」的作品：第 1 集原文即剧本不生成，第 2 集起续写并带第 1 集做前文', async () => {
    backend.reset(episode1Project());
    happy();
    await startPipeline(WORK, { fromStep: 'script', onlyScript: true });
    expect(labels()).toEqual([continueLabel(2), continueLabel(3)]);
    expect(backend.project.episodes.map((e) => e.scriptSource)).toEqual([undefined, 'continued', 'continued']);
    const user = userOf(continueLabel(2));
    expect(user).toContain('【最近剧本（全文）】\n第 1 集《标题1》：\n第 1 集的剧本正文');
    expect(user).not.toContain('【本集对应原文】');
  });

  it('已在运行时不重复启动', async () => {
    happy();
    const first = startPipeline(WORK);
    expect(isPipelineRunning(WORK)).toBe(true);
    expect(await startPipeline(WORK)).toBeNull();
    await first;
    expect(labels()).toHaveLength(8);
  });

  it('保存撞一次版本冲突 → 重读后重试成功', async () => {
    happy();
    backend.conflicts = 1;
    const out = await startPipeline(WORK);
    expect(out?.status).toBe('done');
    expect(backend.project.characters).toHaveLength(1);
  });

  it('没选模型 → 直接失败，不提交任何任务', async () => {
    backend.prefs.model = '';
    const out = await startPipeline(WORK);
    expect(out?.status).toBe('failed');
    expect(labels()).toEqual([]);
    expect(usePipelineStore.getState().runOf(WORK)?.message).toContain('请先在设置页选择模型');
    expect(isPipelineRunning(WORK)).toBe(false);
  });
});
