/**
 * 分集剧本联动的三块（设计共识 2026-11-26 第 3.5 / 3.6 / 3.7 节）：
 * - 待刷新判定里的「本集剧本」这一项
 * - 短剧 store 的统一接收方法 adopt（版本号只增不减；加载、保存、流水线写入共用）
 * - 本集剧本导出文本
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BuiltFrom, DuanjuEpisode, DuanjuProject, DuanjuShot } from '@shared/duanju';
import { newDuanjuProject } from '@shared/duanju';

import { buildEpisodeScriptText } from '../exportScript';
import { isShotStale } from '../stale';

const getMock = vi.fn();
const patchMock = vi.fn();

vi.mock('../../../../api/duanju', () => ({
  getDuanjuProject: (...args: unknown[]) => getMock(...args),
  patchDuanju: (...args: unknown[]) => patchMock(...args),
}));

beforeEach(() => {
  vi.resetModules(); // 每个用例重新加载 store（模块级的已加载作品标记随之重置）
  getMock.mockReset();
  patchMock.mockReset();
});

// ---------- 待刷新判定 ----------

function project(overrides: Partial<Pick<DuanjuProject, 'script' | 'episodes'>> = {}): DuanjuProject {
  return { ...newDuanjuProject({ targetEpisodes: 3, style: '动漫风', protagonists: '' }, 1), ...overrides };
}

function episode(overrides: Partial<DuanjuEpisode> = {}): DuanjuEpisode {
  return { id: 'ep-1', index: 1, title: '一', synopsis: 's', ...overrides };
}

function shot(builtFrom: BuiltFrom): DuanjuShot {
  return {
    id: 's1',
    episodeId: 'ep-1',
    index: 1,
    shotSize: '中景',
    cameraMove: '固定',
    actionStart: '',
    actionEnd: '',
    staging: '',
    dialog: '',
    gridPrompt: '',
    gridParts: [],
    frames: [{ index: 1, image: { id: 'i', path: 'duanju/images/a.png', prompt: 'p', createdAt: 1 }, rolls: 0 }],
    characterIds: [],
    propIds: [],
    sceneId: null,
    builtFrom,
    updatedAt: 1,
  };
}

describe('剧本这一项的待刷新判定', () => {
  it('快照记了本集时刻：只比本集剧本——改别的集、改整本原文都不提醒；改本集才提醒', () => {
    const p = project({
      episodes: [
        episode({ script: '第一集正文', scriptSource: 'adapted', scriptUpdatedAt: 100 }),
        { ...episode({ id: 'ep-2', index: 2 }), script: '第二集', scriptUpdatedAt: 100 },
      ],
    });
    const s = shot({ scriptAt: 1, episodeScriptAt: 100 });
    expect(isShotStale(s, p)).toBe(false);

    const otherEpisodeChanged: DuanjuProject = {
      ...p,
      episodes: [p.episodes[0]!, { ...p.episodes[1]!, script: '第二集改了', scriptUpdatedAt: 200 }],
    };
    expect(isShotStale(s, otherEpisodeChanged)).toBe(false);

    const sourceChanged: DuanjuProject = { ...p, script: { ...p.script, text: '原文改了', updatedAt: 999 } };
    expect(isShotStale(s, sourceChanged)).toBe(false); // 本集剧本没变，整本原文变了不算

    const thisEpisodeChanged: DuanjuProject = {
      ...p,
      episodes: [{ ...p.episodes[0]!, script: '第一集改了', scriptUpdatedAt: 300 }, p.episodes[1]!],
    };
    expect(isShotStale(s, thisEpisodeChanged)).toBe(true);
  });

  it('快照为 0（出图时本集没有剧本）：本集现在有剧本 → 待刷新；仍然没有 → 比整本原文时间', () => {
    const none = project({ episodes: [episode()] });
    const s = shot({ scriptAt: 1, episodeScriptAt: 0 });
    expect(isShotStale(s, none)).toBe(false);

    const sourceChanged: DuanjuProject = { ...none, script: { ...none.script, text: '原文改了', updatedAt: 2 } };
    expect(isShotStale(s, sourceChanged)).toBe(true); // 原规则保留

    const gotScript: DuanjuProject = { ...none, episodes: [episode({ script: '新写的第一集', scriptUpdatedAt: 50 })] };
    expect(isShotStale(s, gotScript)).toBe(true); // 依据变了
  });

  it('旧快照没有这个字段：同快照为 0 的规则', () => {
    const none = project({ episodes: [episode()] });
    const s = shot({ scriptAt: 1 }); // 升级前出的图
    expect(isShotStale(s, none)).toBe(false);
    expect(isShotStale(s, { ...none, episodes: [episode({ script: '后来补写', scriptUpdatedAt: 9 })] })).toBe(true);
    expect(isShotStale(s, { ...none, script: { ...none.script, text: '原文改了', updatedAt: 5 } })).toBe(true);
  });

  it('帧级快照同样按本集剧本判定；每一帧都有自己的快照时以帧级为准；角色变更照旧提醒', () => {
    const p = project({ episodes: [episode({ script: '正文', scriptUpdatedAt: 100 })] });
    const s = shot({ scriptAt: 1, charAt: {} });
    s.builtFrom = { scriptAt: 1, charAt: {}, frameSnapshots: { '1': { scriptAt: 1, episodeScriptAt: 100 } } };
    expect(isShotStale(s, p)).toBe(false);
    s.builtFrom = { scriptAt: 1, charAt: {}, frameSnapshots: { '1': { scriptAt: 1, episodeScriptAt: 90 } } };
    expect(isShotStale(s, p)).toBe(true);
    // 镜级快照停在旧状态（升级前出的图），但唯一的一帧已有自己的新快照：不该被镜级拖成待刷新
    s.builtFrom = { scriptAt: 1, charAt: {}, frameSnapshots: { '1': { scriptAt: 1, episodeScriptAt: 100 } } };
    expect(isShotStale(s, p)).toBe(false);
    // 有帧缺快照：该帧回退镜级判定
    s.frames = [...s.frames, { index: 2, image: { id: 'i2', path: 'duanju/images/b.png', prompt: 'p', createdAt: 1 }, rolls: 0 }];
    s.builtFrom = { scriptAt: 1, charAt: {}, episodeScriptAt: 80, frameSnapshots: { '1': { scriptAt: 1, episodeScriptAt: 100 } } };
    expect(isShotStale(s, p)).toBe(true);

    const withChar: DuanjuProject = {
      ...p,
      characters: [{ id: 'c1', name: '甲', profile: '', sheetImages: [], updatedAt: 7, createdAt: 1 }],
    };
    s.frames = s.frames.slice(0, 1);
    s.characterIds = ['c1'];
    s.builtFrom = { scriptAt: 1, charAt: { c1: 7 }, episodeScriptAt: 100 };
    expect(isShotStale(s, withChar)).toBe(false);
    const charEdited = { ...withChar, characters: [{ ...withChar.characters[0]!, updatedAt: 8 }] };
    expect(isShotStale(s, charEdited)).toBe(true);
  });
});

// ---------- store.adopt ----------

const storeProject = (revision: number): DuanjuProject => ({
  ...newDuanjuProject({ targetEpisodes: 12, style: '动漫风', protagonists: '' }, 1),
  revision,
});

describe('useDuanjuStore.adopt', () => {
  it('不是当前加载的作品 / 版本号比本地小 → 不替换；不小于本地 → 替换', async () => {
    const { useDuanjuStore } = await import('../../store');
    useDuanjuStore.getState().reset();
    useDuanjuStore.getState().adopt('w1', storeProject(5)); // 还没加载过这本书：不生效
    expect(useDuanjuStore.getState().project).toBeNull();

    getMock.mockResolvedValue(storeProject(5));
    await useDuanjuStore.getState().load('w1');
    useDuanjuStore.getState().adopt('w2', storeProject(9)); // 别的作品：不生效
    expect(useDuanjuStore.getState().project?.revision).toBe(5);
    useDuanjuStore.getState().adopt('w1', storeProject(4)); // 旧响应：不退回去
    expect(useDuanjuStore.getState().project?.revision).toBe(5);
    useDuanjuStore.getState().adopt('w1', storeProject(5)); // 同版本：接受
    expect(useDuanjuStore.getState().project?.revision).toBe(5);
    useDuanjuStore.getState().adopt('w1', storeProject(6)); // 新版本：接受
    expect(useDuanjuStore.getState().project?.revision).toBe(6);
  });

  it('加载的旧响应晚于流水线写入到达：不覆盖流水线刚同步的新版本', async () => {
    const { useDuanjuStore } = await import('../../store');
    useDuanjuStore.getState().reset();
    getMock.mockResolvedValue(storeProject(5));
    await useDuanjuStore.getState().load('w1');

    // 发起一次刷新（响应先悬着），期间流水线写入把本地推到 8
    let resolveRefresh: (p: DuanjuProject) => void = () => {};
    getMock.mockImplementationOnce(() => new Promise<DuanjuProject>((r) => { resolveRefresh = r; }));
    const refreshing = useDuanjuStore.getState().load('w1');
    useDuanjuStore.getState().adopt('w1', storeProject(8));
    resolveRefresh(storeProject(6)); // 刷新发出时的服务端版本
    await refreshing;

    expect(useDuanjuStore.getState().project?.revision).toBe(8);
    expect(useDuanjuStore.getState().loading).toBe(false);
  });

  it('保存成功后走 adopt；保存失败置冲突标记、不动作品数据', async () => {
    const { useDuanjuStore } = await import('../../store');
    useDuanjuStore.getState().reset();
    getMock.mockResolvedValue(storeProject(5));
    await useDuanjuStore.getState().load('w1');

    patchMock.mockResolvedValueOnce(storeProject(6));
    expect(await useDuanjuStore.getState().patch('w1', { style: '写实' })).toBe(true);
    expect(useDuanjuStore.getState().project?.revision).toBe(6);
    expect(useDuanjuStore.getState().conflict).toBe(false);

    patchMock.mockRejectedValueOnce(new Error('版本冲突'));
    expect(await useDuanjuStore.getState().patch('w1', { style: '水墨' })).toBe(false);
    expect(useDuanjuStore.getState().project?.revision).toBe(6);
    expect(useDuanjuStore.getState().conflict).toBe(true);
  });
});

// ---------- 本集剧本导出文本 ----------

describe('本集剧本导出文本', () => {
  it('集名 + 画风 + 梗概 + 正文；没有梗概时不留空行', () => {
    const p = project();
    const ep: DuanjuEpisode = { id: 'e', index: 2, title: '裂纹之钥', synopsis: '雾还没散尽', sourceStart: '', sourceEnd: '' };
    const text = buildEpisodeScriptText(p, ep, '场1 外·山道·黄昏\n正文');
    expect(text).toContain('《裂纹之钥》第 2 集 · 动漫风');
    expect(text).toContain('【本集梗概】雾还没散尽');
    expect(text).toContain('场1 外·山道·黄昏\n正文');
    const noSynopsis = buildEpisodeScriptText(p, { ...ep, synopsis: '' }, '正文');
    expect(noSynopsis).not.toContain('【本集梗概】');
    expect(noSynopsis).toContain(`${'─'.repeat(46)}\n正文\n${'─'.repeat(46)}`); // 分隔线与正文紧挨，不留空行
  });
});
