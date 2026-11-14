/**
 * 成本优化件单测：帧工具（missingFrames/buildFrameTasks）+ 站位快览（parseStaging）+ 成本统计（spendStats）
 */
import { describe, expect, it } from 'vitest';

import { missingFrames, buildFrameTasks } from '../cost/frameGrid';
import { parseStaging } from '../cost/stagingMap';
import { spendStats } from '../cost/spendStats';
import type { DuanjuCharacter, DuanjuProject, DuanjuShot } from '@shared/duanju';

const NOW = 1700000000000;

const chars: DuanjuCharacter[] = [
  { id: 'c1', name: '小满', profile: '蓝发', sheetImages: [], refImageId: null, updatedAt: 100 },
  { id: 'c2', name: '阿噗', profile: '黑发', sheetImages: [], refImageId: null, updatedAt: 100 },
];

function makeShot(overrides: Partial<DuanjuShot> = {}): DuanjuShot {
  return {
    id: 'sh1',
    episodeId: 'ep1',
    index: 1,
    shotSize: '中景',
    cameraMove: '固定',
    actionStart: 'a',
    actionEnd: 'b',
    staging: '',
    dialog: '',
    gridParts: ['起', '承', '转', '合'],
    gridPrompt: '',
    frames: [],
    characterIds: ['c1'],
    propIds: [],
    sceneId: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeProject(overrides: Partial<DuanjuProject> = {}): DuanjuProject {
  return {
    revision: 1,
    script: { source: 'manual', text: 't', confirmed: true, updatedAt: 100 },
    reviewCards: {
      summary: '', eventChain: [], conflict: '', characterRelations: '',
      emotionPoints: [], visualActions: [], riskReplacements: [],
    },
    style: '动漫风',
    targetEpisodes: 12,
    protagonists: '',
    characters: chars,
    scenes: [],
    props: [],
    episodes: [{ id: 'ep1', index: 1, title: '一', synopsis: '' }],
    shots: [],
    spendLog: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('missingFrames', () => {
  it('无帧 → 1-4 全部；有 2/4 帧 → 缺 1/3', () => {
    expect(missingFrames(makeShot())).toEqual([1, 2, 3, 4]);
    const shot = makeShot({
      frames: [
        { index: 2, image: { id: 'a', path: 'p', prompt: '', createdAt: 1 }, rolls: 0 },
        { index: 4, image: { id: 'b', path: 'p', prompt: '', createdAt: 1 }, rolls: 1 },
      ],
    });
    expect(missingFrames(shot)).toEqual([1, 3]);
  });

  it('旧数据 frames undefined → 按 1-4 全缺（防御）', () => {
    expect(missingFrames({ frames: undefined } as unknown as DuanjuShot)).toEqual([1, 2, 3, 4]);
  });
});

describe('buildFrameTasks（整集批量）', () => {
  it('空镜头 → 4 帧任务；旧整图完成态 → 跳过；半成品 → 只补缺帧', () => {
    const project = makeProject();
    const empty = makeShot({ id: 'a' });
    const legacy = makeShot({
      id: 'b',
      index: 2,
      gridImage: { id: 'g', path: 'p', prompt: '', createdAt: 1 },
    });
    const half = makeShot({
      id: 'c',
      index: 3,
      frames: [{ index: 1, image: { id: 'x', path: 'p', prompt: '', createdAt: 1 }, rolls: 0 }],
    });
    const tasks = buildFrameTasks([empty, legacy, half], project);
    // empty 4 帧 + half 3 帧 = 7；legacy 跳过
    expect(tasks).toHaveLength(7);
    expect(tasks[0]).toMatchObject({ input: { kind: 'frame', refId: 'a', frameIndex: 1 }, label: '镜头 1 · F1' });
    expect(tasks.some((t) => t.input.refId === 'b')).toBe(false);
    expect(tasks.filter((t) => t.input.refId === 'c').map((t) => t.input.frameIndex)).toEqual([2, 3, 4]);
  });

  it('帧 prompt 含帧描述 + 人物锚点；provider 透传', () => {
    const tasks = buildFrameTasks([makeShot({ gridParts: ['低头', '抬头', '握拳', '起身'] })], makeProject(), 'zhipu');
    expect(tasks[0].input.prompt).toContain('低头');
    expect(tasks[0].input.prompt).toContain('小满（蓝发）');
    expect(tasks[0].input.provider).toBe('zhipu');
    expect(tasks[3].input.prompt).toContain('起身');
  });
});

describe('parseStaging（站位快览）', () => {
  it('左/中/右关键词就近归位', () => {
    const map = parseStaging('小满在画面左侧，阿噗站在右侧', chars);
    expect(map.left).toEqual(['小满']);
    expect(map.right).toEqual(['阿噗']);
    expect(map.center).toEqual([]);
  });

  it('中央/前方/身旁 → 中区', () => {
    expect(parseStaging('小满位于中央', chars).center).toEqual(['小满']);
    expect(parseStaging('阿噗站在小满身旁', chars).center).toEqual(['小满', '阿噗']);
  });

  it('无站位文本或未提及 → unknown', () => {
    const map = parseStaging('', chars);
    expect(map.unknown).toEqual(['小满', '阿噗']);
    expect(parseStaging('空镜头无人', chars).unknown).toEqual(['小满', '阿噗']);
  });
});

describe('spendStats（成本仪表盘）', () => {
  const img = (id: string) => ({ id, path: 'duanju/images/x.png', prompt: '', createdAt: 1 });

  it('记账分桶 + 重roll 计数（同 kind:refId:note 重复）', () => {
    const project = makeProject({
      spendLog: [
        { ts: 1, kind: 'character', refId: 'c1' },
        { ts: 2, kind: 'character', refId: 'c1' }, // 重roll 1
        { ts: 3, kind: 'frame', refId: 'sh1', note: 'frame-2' },
        { ts: 4, kind: 'frame', refId: 'sh1', note: 'frame-2' }, // 重roll 1
        { ts: 5, kind: 'frame', refId: 'sh1', note: 'frame-3' }, // 不同帧不算重roll
        { ts: 6, kind: 'scene', refId: 's1' },
        { ts: 7, kind: 'shot', refId: 'sh1' },
      ],
    });
    const s = spendStats(project);
    expect(s.logged).toBe(7);
    expect(s.byKind).toEqual({ character: 2, outfit: 0, scene: 1, shot: 1, frame: 3 });
    expect(s.rollCount).toBe(2);
    expect(s.estCostYuan).toBe(0.8); // 7 × 0.12，一位小数四舍五入
  });

  it('盘面数 = 设定图 + 场景图 + 帧 + 旧整图；spendLog 缺省（旧数据）防御', () => {
    const project = makeProject({
      characters: [chars[0]],
      scenes: [{ id: 's1', name: '荒原', spec: '', images: [img('s-img')], updatedAt: 1 }],
      shots: [
        makeShot({
          frames: [
            { index: 1, image: img('f1'), rolls: 0 },
            { index: 2, image: img('f2'), rolls: 0 },
          ],
          gridImage: img('g1'),
        }),
      ],
    });
    const s = spendStats(project);
    // chars[0].sheetImages=0 设定图 + 1 场景图 + 2 帧 + 1 旧整图 = 4
    expect(s.existingAssets).toBe(4);
    // spendLog 缺省 undefined 防御（旧 project.json 无此字段）
    const { spendLog: _omit, ...rest } = makeProject();
    void _omit;
    const legacy = rest as DuanjuProject;
    expect(spendStats(legacy).logged).toBe(0);
  });
});
