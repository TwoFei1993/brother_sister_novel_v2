/**
 * 分镜库单测（实施计划 T3.x）：stale 推导 + 四宫格/视频提示词组装 + 拆镜头解析
 */
import { describe, expect, it } from 'vitest';

import { isShotStale, storyboardHealth } from '../stale';
import { buildGridPrompt, buildVideoPrompt, parseStoryboard } from '../prompts-storyboard';
import { mergeEpisodes, parseBreakdown } from '../prompts-script';
import type { DuanjuCharacter, DuanjuProject, DuanjuScene, DuanjuShot } from '@shared/duanju';

const NOW = 1700000000000;

const char: DuanjuCharacter = {
  id: 'c1',
  name: '小满',
  profile: '蓝发双马尾红瞳',
  sheetImages: [],
  refImageId: null,
  updatedAt: 100,
};
const scene: DuanjuScene = {
  id: 's1',
  name: '荒原',
  spec: '紫色草丛双月',
  images: [],
  updatedAt: 100,
};

function makeProject(overrides: Partial<DuanjuProject> = {}): DuanjuProject {
  return {
    revision: 1,
    script: { source: 'manual', text: '剧本', confirmed: true, updatedAt: 100 },
    reviewCards: {
      summary: '', eventChain: [], conflict: '', characterRelations: '',
      emotionPoints: [], visualActions: [], riskReplacements: [],
    },
    style: '动漫风',
    targetEpisodes: 12,
    protagonists: '',
    characters: [char],
    scenes: [scene],
    episodes: [{ id: 'ep1', index: 1, title: '第一集', synopsis: '' }],
    shots: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeShot(overrides: Partial<DuanjuShot> = {}): DuanjuShot {
  return {
    id: 'sh1',
    episodeId: 'ep1',
    index: 1,
    shotSize: '中景',
    cameraMove: '推',
    actionStart: '起身',
    actionEnd: '奔跑',
    staging: '画面中央',
    dialog: '快跑！',
    sound: '风声',
    gridPrompt: '',
    characterIds: ['c1'],
    sceneId: 's1',
    updatedAt: NOW,
    ...overrides,
  };
}

describe('isShotStale', () => {
  it('无图不算 stale；有图且快照一致 → 不 stale', () => {
    const shot = makeShot();
    expect(isShotStale(shot, makeProject())).toBe(false);
    const withImg = makeShot({
      gridImage: { id: 'i', path: 'duanju/images/a.png', prompt: 'p', createdAt: 1 },
      builtFrom: { scriptAt: 100, charAt: { c1: 100 }, sceneAt: { s1: 100 } },
    });
    expect(isShotStale(withImg, makeProject())).toBe(false);
  });

  it('剧本 updatedAt 变 → stale', () => {
    const withImg = makeShot({
      gridImage: { id: 'i', path: 'p', prompt: 'p', createdAt: 1 },
      builtFrom: { scriptAt: 100 },
    });
    const project = makeProject();
    project.script.updatedAt = 999;
    expect(isShotStale(withImg, project)).toBe(true);
  });

  it('出场角色 updatedAt 变 / 角色被删 → stale', () => {
    const withImg = makeShot({
      gridImage: { id: 'i', path: 'p', prompt: 'p', createdAt: 1 },
      builtFrom: { charAt: { c1: 100 } },
    });
    const changed = makeProject();
    changed.characters[0].updatedAt = 999;
    expect(isShotStale(withImg, changed)).toBe(true);

    const deleted = makeProject();
    deleted.characters = [];
    expect(isShotStale(withImg, deleted)).toBe(true);
  });

  it('场景 updatedAt 变 / 场景被删 → stale', () => {
    const withImg = makeShot({
      gridImage: { id: 'i', path: 'p', prompt: 'p', createdAt: 1 },
      builtFrom: { sceneAt: { s1: 100 } },
    });
    const changed = makeProject();
    changed.scenes[0].updatedAt = 999;
    expect(isShotStale(withImg, changed)).toBe(true);
  });

  it('storyboardHealth 聚合', () => {
    const shotA = makeShot({
      id: 'a',
      gridImage: { id: 'i', path: 'p', prompt: 'p', createdAt: 1 },
      builtFrom: { scriptAt: 100 },
    });
    const shotB = makeShot({ id: 'b', index: 2 });
    const project = makeProject({ shots: [shotA, shotB] });
    expect(storyboardHealth(project, 'ep1')).toEqual({ stale: 0, withImage: 1, total: 2 });
    project.script.updatedAt = 999;
    expect(storyboardHealth(project, 'ep1').stale).toBe(1);
  });
});

describe('buildGridPrompt / buildVideoPrompt', () => {
  it('四宫格：画风前缀 + 人物锚点 + 场景 + 四格描述', () => {
    const project = makeProject();
    const shot = makeShot();
    const prompt = buildGridPrompt(shot, ['格1', '格2', '格3', '格4'], project);
    expect(prompt).toContain('四宫格分镜图');
    expect(prompt).toContain('小满（蓝发双马尾红瞳）');
    expect(prompt).toContain('荒原');
    expect(prompt).toContain('第1格：格1');
    expect(prompt).toContain('第4格：格4');
    expect(prompt).toContain('中景');
  });

  it('视频提示词：衔接动作 + 声音 + 画风', () => {
    const prompt = buildVideoPrompt(makeShot(), makeProject());
    expect(prompt).toContain('从「起身」到「奔跑」');
    expect(prompt).toContain('对白：「快跑！」');
    expect(prompt).toContain('声音：风声');
    expect(prompt).toContain('动漫风');
  });
});

describe('parseStoryboard', () => {
  it('合法 JSON（含围栏）→ 镜头列表 + 角色/场景名映射 id + gridPrompt 组装', () => {
    const raw = '```json\n[{"shotSize":"近景","cameraMove":"固定","actionStart":"低头","actionEnd":"抬头","staging":"左侧","dialog":"嗯","sound":"雨声","gridParts":["低头","抬头","握拳","起身"],"characters":["小满"],"scene":"荒原"}]\n```';
    const project = makeProject();
    const shots = parseStoryboard(raw, 'ep1', project);
    expect(shots).toHaveLength(1);
    expect(shots[0].characterIds).toEqual(['c1']);
    expect(shots[0].sceneId).toBe('s1');
    expect(shots[0].gridPrompt).toContain('第1格：低头');
  });

  it('未知角色名 → 忽略；非法输入 → 空数组', () => {
    const raw = '[{"shotSize":"远景","characters":["路人甲"],"gridParts":["a"]}]';
    const shots = parseStoryboard(raw, 'ep1', makeProject());
    expect(shots[0].characterIds).toEqual([]);
    expect(parseStoryboard('不是JSON', 'ep1', makeProject())).toEqual([]);
  });
});

describe('mergeEpisodes（拆解重跑防孤儿，深度测试 D-2 回归）', () => {
  const existing = [
    { id: 'ep-old-1', index: 1, title: '旧标题', synopsis: '旧梗概' },
    { id: 'ep-old-2', index: 2, title: '第二集', synopsis: '' },
  ];

  it('同 index 保留原 id（旧集 shots 不成孤儿），标题/梗概刷新', () => {
    const merged = mergeEpisodes(existing, [
      { index: 1, title: '新标题', synopsis: '新梗概' },
    ]);
    expect(merged[0].id).toBe('ep-old-1');
    expect(merged[0].title).toBe('新标题');
    expect(merged[0].synopsis).toBe('新梗概');
  });

  it('新 index 生成新 id；未覆盖的旧集保留在数组外由调用方决定', () => {
    const merged = mergeEpisodes(existing, [
      { index: 1, title: 'A', synopsis: '' },
      { index: 3, title: 'C', synopsis: '' },
    ]);
    expect(merged.map((e) => e.id)).toEqual(['ep-old-1', expect.stringMatching(/^ep-\d+-3$/)]);
  });

  it('parseBreakdown 输出可直接喂 mergeEpisodes', () => {
    const parsed = parseBreakdown('{"summary":"s","episodes":[{"index":1,"title":"t","synopsis":"g"}]}');
    expect(parsed).not.toBeNull();
    if (parsed) expect(mergeEpisodes(existing, parsed.episodes)[0].id).toBe('ep-old-1');
  });
});

describe('mergeEpisodes 防丢数据（R3 加固）', () => {
  const existing = [
    { id: 'ep-1', index: 1, title: '一', synopsis: '' },
    { id: 'ep-2', index: 2, title: '待定', synopsis: '' },
    { id: 'ep-3', index: 3, title: '待定', synopsis: '' },
  ];
  const shots = [{ episodeId: 'ep-3' }]; // 用户给第 3 集手动加过镜头

  it('模型只回 1 集时：挂有镜头的旧集仍保留，空待定集才丢弃', () => {
    const merged = mergeEpisodes(existing, [{ index: 1, title: '新一', synopsis: 'g' }], shots);
    expect(merged.map((e) => e.id)).toEqual(['ep-1', 'ep-3']);
  });

  it('不传 shots（旧签名兼容）：行为同前——只保留 parsed 覆盖的集', () => {
    const merged = mergeEpisodes(existing, [{ index: 1, title: 'a', synopsis: '' }]);
    expect(merged).toHaveLength(1);
  });
});

describe('extractJsonArray 污染容错（反馈 #11 拆镜头失败回归）', () => {
  it('围栏+尾逗号+行内注释+嵌套数组 → 正确解析', () => {
    const dirty = '好的，以下是拆解结果：\n```json\n[\n  {"shotSize":"近景","gridParts":["a","b",],"characters":["小满"]}, // 第一镜\n  {"shotSize":"全景","gridParts":["c","d"],"characters":["小满","阿噗"]},\n]\n```\n以上。';
    const shots = parseStoryboard(dirty, 'ep1', makeProject());
    expect(shots).toHaveLength(2);
    expect(shots[0].gridPrompt).toContain('第1格：a');
  });

  it('模型输出带解说前缀且字符串值缺引号（中文括号形态）→ 修复解析', () => {
    const dirty = '这是结果：[{"shotSize":"中景","sound":（无对白，只有环境音）,"gridParts":["x"]}]';
    const shots = parseStoryboard(dirty, 'ep1', makeProject());
    expect(shots).toHaveLength(1);
    expect(shots[0].sound).toBe('无对白，只有环境音');
  });
});
