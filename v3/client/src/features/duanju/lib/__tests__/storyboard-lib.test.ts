/**
 * 分镜库单测（实施计划 T3.x）：stale 推导 + 四宫格/视频提示词组装 + 拆镜头解析
 */
import { describe, expect, it } from 'vitest';

import { isShotStale, storyboardHealth } from '../stale';
import {
  activeStates,
  buildFramePrompt,
  buildGridPrompt,
  buildStoryboardMessages,
  parseStoryboard,
  propAnchorLine,
  validateStoryboardIssues,
} from '../prompts/prompts-storyboard';
import { buildLocalVideoPrompt, buildVideoPrompt } from '../prompts/prompts-video';
import { mergeEpisodes, parseBreakdown } from '../prompts/prompts-script';
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
    characters: [{ ...char }], // 克隆防突变泄漏：测试改 updatedAt 不得污染后续用例的共享 fixture
    scenes: [{ ...scene }],
    props: [],
    episodes: [{ id: 'ep1', index: 1, title: '第一集', synopsis: '' }],
    shots: [],
    spendLog: [],
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
    gridParts: [],
    gridPrompt: '',
    frames: [],
    characterIds: ['c1'],
    propIds: [],
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
      builtFrom: { scriptAt: 100, charAt: { c1: 100 }, sceneAt: { s1: 100 } },
    });
    const shotB = makeShot({ id: 'b', index: 2 });
    const project = makeProject({ shots: [shotA, shotB] });
    expect(storyboardHealth(project, 'ep1')).toEqual({ stale: 0, withImage: 1, total: 2 });
    project.script.updatedAt = 999;
    expect(storyboardHealth(project, 'ep1').stale).toBe(1);
  });

  it('出图后新增的角色/场景关联（快照无记录）→ stale（P2 修复语义）', () => {
    const withImg = makeShot({
      gridImage: { id: 'i', path: 'p', prompt: 'p', createdAt: 1 },
      builtFrom: { scriptAt: 100 }, // 快照只有 script——c1 关联未锚定
    });
    expect(isShotStale(withImg, makeProject())).toBe(true);
    const anchored = { ...withImg, builtFrom: { scriptAt: 100, charAt: { c1: 100 }, sceneAt: { s1: 100 } } };
    const p = makeProject();
    p.shots = [anchored];
    expect(isShotStale(anchored, p)).toBe(false);
  });

  it('分帧镜头（无 gridImage）同样参与 stale 推导与 withImage 统计', () => {
    const frameImg = { id: 'f', path: 'p', prompt: '', createdAt: 1 };
    const framed = makeShot({
      frames: [{ index: 1, image: frameImg, rolls: 0 }],
      builtFrom: { scriptAt: 100, charAt: { c1: 100 }, sceneAt: { s1: 100 } },
    });
    const project = makeProject({ shots: [framed] });
    expect(isShotStale(framed, project)).toBe(false); // 快照一致
    expect(storyboardHealth(project, 'ep1').withImage).toBe(1);
    project.script.updatedAt = 999;
    expect(isShotStale(framed, project)).toBe(true); // 上游变 → 待刷新
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
    expect(prompt).toContain('人物：小满');
    expect(prompt).toContain('对白：「快跑！」');
    
    expect(prompt).toContain('动漫风');
  });
});

describe('buildFramePrompt（分帧，成本优化 A 项）', () => {
  it('单帧：帧序号 + 该帧描述 + 人物锚点 + 一致性要求 + 镜头语言', () => {
    const project = makeProject();
    const shot = makeShot({ gridParts: ['低头', '抬头', '握拳', '起身'] });
    const p2 = buildFramePrompt(shot, 2, project);
    expect(p2).toContain('第 2/4 帧');
    expect(p2).toContain('【画面主体】抬头'); // 详细版：主体瞬间段（含力势/情绪指令）
    expect(p2).toContain('小满（蓝发双马尾红瞳）');
    expect(p2).toContain('完全一致');
    expect(p2).toContain('荒原');
    expect(p2).toContain('【镜头语言】'); // 详细版：景别映射成可执行构图指令
    expect(p2).not.toContain('握拳'); // 不串其他帧
  });

  it('gridParts 为空 → 默认四段兜底；无人物 → 纯场景帧', () => {
    const p = buildFramePrompt(makeShot({ gridParts: [], characterIds: [] }), 3, makeProject());
    expect(p).toContain('高潮瞬间');
    expect(p).toContain('【无人物】');
  });
});

describe('parseStoryboard', () => {
  it('合法 JSON（含围栏）→ 镜头列表 + 角色/场景名映射 id + gridPrompt 组装 + gridParts 数据化', () => {
    const raw = '```json\n[{"shotSize":"近景","cameraMove":"固定","actionStart":"低头","actionEnd":"抬头","staging":"左侧","dialog":"嗯","sound":"雨声","gridParts":["低头","抬头","握拳","起身"],"characters":["小满"],"scene":"荒原"}]\n```';
    const project = makeProject();
    const shots = parseStoryboard(raw, 'ep1', project);
    expect(shots).toHaveLength(1);
    expect(shots[0].characterIds).toEqual(['c1']);
    expect(shots[0].sceneId).toBe('s1');
    expect(shots[0].gridPrompt).toContain('第1格：低头');
    expect(shots[0].gridParts).toEqual(['低头', '抬头', '握拳', '起身']);
    expect(shots[0].frames).toEqual([]);
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
  });
});

describe('批1 深度验证：json-extract 每功能 3 例（goal）', () => {
  it('例1：完整真实形态——围栏+解说+尾逗号+行内注释+嵌套 gridParts', () => {
    const dirty = '根据剧本拆解如下：\n```json\n[\n  {"shotSize":"近景","cameraMove":"固定","actionStart":"抬头","actionEnd":"起身","staging":"左侧","dialog":"","sound":"雨声","gridParts":["抬头","起身","走位","停下",],"characters":["小满"],}, // 第一镜\n  {"shotSize":"远景","cameraMove":"推","actionStart":"开门","actionEnd":"入内","staging":"门口","dialog":"谁？","sound":"风","gridParts":["门缝","推门","入内","回身",],"characters":[],},\n]\n```\n希望符合要求。';
    const shots = parseStoryboard(dirty, 'ep1', makeProject());
    expect(shots).toHaveLength(2);
    expect(shots[0].actionStart).toBe('抬头');
    expect(shots[1].dialog).toBe('谁？');
    expect(shots[0].gridPrompt).toContain('第4格：停下');
  });

  it('例2：单引号键值形态（Python 风格输出）', () => {
    const dirty = "[{name: '老陈', shotSize: '中景', cameraMove: '固定', actionStart: '擦手', actionEnd: '端面', staging: '灶台', dialog: '来了', sound: '沸水声', gridParts: ['擦手','下面','浇卤','端面'], characters: ['老陈'], scene: '食堂'}]";
    const shots = parseStoryboard(dirty, 'ep1', makeProject());
    expect(shots.length).toBeGreaterThanOrEqual(1);
    expect(shots[0].dialog).toBe('来了');
    expect(shots[0].cameraMove).toBe('固定');
  });

  it('例3：审核卡对象——围栏+前后解说+嵌套数组+风险列表', () => {
    const raw = '拆解完成。\n```json\n{"summary":"s","eventChain":["e1","e2",],"conflict":"c","characterRelations":"r","emotionPoints":["x",],"visualActions":["v"],"riskReplacements":[{"original":"o","replacement":"p",}], "episodes":[{"index":1,"title":"t","synopsis":"g",}],}\n```';
    const r = parseBreakdown(raw);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.eventChain).toEqual(['e1', 'e2']);
    expect(r.riskReplacements).toHaveLength(1);
    expect(r.episodes[0].title).toBe('t');
  });
});

describe('批验证：durationSec + 剧本导出时间轴（用户反馈 #3）', () => {
  it('例1：AI 拆镜头输出 durationSec → Shot 字段落库', () => {
    const raw = '[{"shotSize":"中景","durationSec":7,"actionStart":"a","actionEnd":"b","gridParts":["x"]},{"shotSize":"全景","durationSec":12,"actionStart":"c","actionEnd":"d","gridParts":["y"]}]';
    const shots = parseStoryboard(raw, 'ep1', makeProject());
    expect(shots[0].durationSec).toBe(7);
    expect(shots[1].durationSec).toBe(12);
  });

  it('例2：durationSec 非法（0/超 120/缺省）→ undefined 走默认 8 秒', () => {
    const raw = '[{"shotSize":"a","durationSec":0,"gridParts":[]},{"shotSize":"b","durationSec":999,"gridParts":[]},{"shotSize":"c","gridParts":[]}]';
    const shots = parseStoryboard(raw, 'ep1', makeProject());
    expect(shots[0].durationSec).toBeUndefined();
    expect(shots[1].durationSec).toBeUndefined();
  });

  it('例3：剧本 TXT 导出含秒级时间轴（0:00-0:08 形式）+ md 含时间码列', async () => {
    const { buildTimeline } = await import('../exportScript');
    const s1 = makeShot({ id: 'a', index: 1, durationSec: 8 });
    const s2 = makeShot({ id: 'b', index: 2, durationSec: 12 });
    const tl = buildTimeline([s1, s2]);
    expect(tl[0]).toMatchObject({ start: 0, end: 8 });
    expect(tl[1]).toMatchObject({ start: 8, end: 20 });
    // md 含时间码列（buildScriptMd 经动态 import 避免循环依赖）
    const { buildScriptMd, buildScriptTxt } = await import('../exportScript');
    const project = makeProject({ shots: [s1, s2] });
    const md = buildScriptMd(project, project.episodes[0], [s1, s2]);
    expect(md).toContain('| 0:00-0:08 |');
    expect(md).toContain('| 0:08-0:20 |');
    expect(md).toContain('预估时长 0:20');
    const txt = buildScriptTxt(project, project.episodes[0], [s1, s2]);
    expect(txt).toContain('0:00 - 0:08');
    expect(txt).toContain('预估时长 0:20');
  });
});

describe('buildLocalVideoPrompt v2（四帧时间轴 + 人物规格 + 首尾帧对齐）', () => {
  const fourParts = ['起手描述', '进行描述', '高潮描述', '收势描述'];
  const voiced = makeShot({ gridParts: [...fourParts], durationSec: 8 });

  it('flf2v：picture 1/2 对齐声明 + 四段均分时间轴 + 首尾呼应 + 人物规格 + 量化运镜', () => {
    const p = buildLocalVideoPrompt(voiced, [{ name: '小满', profile: '蓝发双马尾红瞳' }], { hasLastFrame: true });
    expect(p).toContain('picture 1 matches the opening frame exactly at 0.0s');
    expect(p).toContain('picture 2 matches the closing frame exactly at 8.0s');
    expect(p).toContain('[0.0s-2.0s] 起手描述 — precisely match the opening state');
    expect(p).toContain('[2.0s-4.0s] 进行描述');
    expect(p).toContain('[6.0s-8.0s] 收势描述 — arrive exactly at the closing frame state');
    expect(p).toContain('[Character spec] 小满（蓝发双马尾红瞳）');
    expect(p).toContain('slow dolly-in'); // 「推」量化
    expect(p).toContain('<d>[Chinese] 快跑！</d>');
  });

  it('i2v（无尾帧）：只锚首帧，无 picture 2；上一镜段末状态注入 Continuity', () => {
    const p = buildLocalVideoPrompt(voiced, [], { prevEndState: '小满站在崖边回望' });
    expect(p).toContain('opening frame at 0.0s must precisely match the reference picture');
    expect(p).not.toContain('picture 2');
    expect(p).toContain('[Continuity] opening continues naturally from the previous shot');
    expect(p).toContain('小满站在崖边回望');
    expect(p).not.toContain('[Character spec]');
  });

  it('A2 铁律：默认声音为正向描述，禁 no-background-music 否定式', () => {
    const silent = makeShot({ gridParts: [...fourParts], dialog: '' });
    const p = buildLocalVideoPrompt(silent);
    expect(p).toContain('overall_soundscape: ambient sound and action sound only');
    expect(p).not.toContain('no background music');
    expect(p).not.toContain('<d>');
  });

  it('gridParts 不足 4 段时时间轴收缩；空时 fallback 动作起终点', () => {
    const two = makeShot({ gridParts: ['起', '收'], durationSec: 6 });
    const p2 = buildLocalVideoPrompt(two, [], { hasLastFrame: true });
    expect(p2).toContain('[0.0s-3.0s] 起');
    expect(p2).toContain('[3.0s-6.0s] 收');
    const none = buildLocalVideoPrompt(makeShot({ gridParts: [] }));
    expect(none).toContain('起身 → 奔跑');
  });
});

describe('buildLocalVideoPrompt v3（drama-skills H3 方言六项）', () => {
  const fourParts = ['起手描述', '进行描述', '高潮描述', '收势描述'];
  const base = { gridParts: [...fourParts], durationSec: 8 };

  it('P0-1/2：non_diegetic_music: N/A 显式 + 字幕禁令（无画内文字）', () => {
    const p = buildLocalVideoPrompt(makeShot({ ...base, dialog: '' }));
    expect(p).toContain('non_diegetic_music: N/A');
    expect(p).toContain('free of any captions, subtitles or text overlays');
  });

  it('P0-2 例外：有画内文字时逐字声明为例外', () => {
    const p = buildLocalVideoPrompt(makeShot({ ...base, dialog: '', onScreenText: '转账 520,000' }));
    expect(p).toContain('转账 520,000');
    expect(p).toContain('only on-screen text');
  });

  it('P0-3/4/8：说话人 (S1) 绑定 + 同框闭嘴 + 锁面逐字注入', () => {
    const p = buildLocalVideoPrompt(
      makeShot({ ...base, speaker: '小满' }),
      [
        { name: '小满', profile: '蓝发', lockPhrase: 'long silver braid, amber eyes' },
        { name: '阿噗', profile: '黑发' },
      ],
    );
    expect(p).toContain('小满 (S1)');
    expect(p).toContain('speaks after a brief natural pause');
    expect(p).toContain('阿噗 does not speak');
    expect(p).toContain('lips remain completely closed');
    expect(p).toContain('long silver braid, amber eyes');
  });

  it('P0-6：t2v 画风守护首句（动漫 → not live-action）', () => {
    const p = buildLocalVideoPrompt(
      makeShot({ ...base, dialog: '' }),
      [],
      { textToVideo: true, styleGuard: 'A 2D hand-drawn anime animation' },
    );
    expect(p.startsWith('A 2D hand-drawn anime animation')).toBe(true);
    expect(p).toContain('not live-action');
  });

  it('P0-3 兜底：无 speaker 字段时回退首角色名', () => {
    const p = buildLocalVideoPrompt(makeShot({ ...base }), [{ name: '小满', profile: '蓝发' }]);
    expect(p).toContain('小满 (S1)');
  });

  it('P0-5 机检：台词超容量/缺说话人出警告', () => {
    const issues = validateStoryboardIssues([
      makeShot({ index: 1, durationSec: 5, dialog: '这是一段很长很长的台词超过五秒镜头的容量会导致赶词或者直接截断', speaker: '小满' }),
      makeShot({ index: 2, durationSec: 8, dialog: '短台词' }),
    ]);
    expect(issues.some((i) => i.includes('S1 台词'))).toBe(true);
    expect(issues.some((i) => i.includes('S2 有台词但未标说话人'))).toBe(true);
  });
});

describe('P2：状态时间线 + 道具锚点（drama-skills 对照）', () => {
  it('activeStates：fromEpisode 过滤——未到集不注入、全程状态恒注入', () => {
    const char = { states: [{ note: '右手缠绷带', fromEpisode: 3 }, { note: '左耳耳环' }] };
    expect(activeStates(char, 2)).toEqual(['左耳耳环']);
    expect(activeStates(char, 3)).toEqual(['右手缠绷带', '左耳耳环']);
  });

  it('propAnchorLine：关联道具生成注入行；无关联空串', () => {
    const proj = makeProject({ props: [{ id: 'p1', name: '旧怀表', spec: '黄铜壳、链绳磨白发灰、表盘右上角裂纹', images: [], updatedAt: 1 }] });
    const withProp = { ...makeShot(), propIds: ['p1'] };
    const line = propAnchorLine(withProp, proj);
    expect(line).toContain('旧怀表');
    expect(line).toContain('黄铜壳');
    expect(line).toContain('逐字保持一致');
    expect(propAnchorLine(makeShot(), proj)).toBe('');
  });

  it('buildFramePrompt：状态行 + 道具行注入（第 3 集 shot 命中 fromEpisode=3 状态）', () => {
    const proj = makeProject({
      episodes: [{ id: 'ep3', index: 3, title: '三', synopsis: '' }],
      characters: [{ ...makeProject().characters[0], id: 'c9', states: [{ note: '右手掌沾血', fromEpisode: 2 }] }],
      props: [{ id: 'p1', name: '银色翻盖手机', spec: '右下角磕痕', images: [], updatedAt: 1 }],
    });
    const shot = { ...makeShot(), episodeId: 'ep3', characterIds: ['c9'], propIds: ['p1'] };
    const p = buildFramePrompt(shot, 1, proj);
    expect(p).toContain('【当前状态】');
    expect(p).toContain('右手掌沾血');
    expect(p).toContain('银色翻盖手机');
    expect(p).toContain('右下角磕痕');
  });

  it('parseStoryboard：道具名映射 propIds；未知名忽略', () => {
    const raw = '[{"shotSize":"中景","gridParts":["a"],"characters":[],"scene":"","props":["旧怀表","不存在的"]}]';
    const proj = makeProject({ props: [{ id: 'p1', name: '旧怀表', spec: 'x', images: [], updatedAt: 1 }] });
    const shots = parseStoryboard(raw, 'ep1', proj);
    expect(shots[0].propIds).toEqual(['p1']);
  });
});

describe('validateStoryboardIssues（A4 机检）', () => {
  it('时长超带宽 / 格字数超 / 声音否定式 → 各出一条警告', () => {
    const issues = validateStoryboardIssues([
      makeShot({ index: 1, durationSec: 20, gridParts: ['短', 'x'.repeat(130)] }),

    ]);
    expect(issues.some((i) => i.includes('S1 时长 20s'))).toBe(true);
    expect(issues.some((i) => i.includes('第 2 格 130 字'))).toBe(true);

  });

  it('正常镜头零警告（无台词）', () => {
    expect(validateStoryboardIssues([makeShot({ gridParts: ['x'.repeat(50)], dialog: '' })])).toEqual([]);
  });

  it('有台词的镜头标了 speaker 才零警告', () => {
    expect(validateStoryboardIssues([makeShot({ gridParts: ['x'.repeat(50)], dialog: '快跑！', speaker: '小满' })])).toEqual([]);
  });
});

describe('T8 机制锚注入（#6）', () => {
  it('选中机制 → user 消息含机制块与标题；未选 → 无机制块', () => {
    const withMech = buildStoryboardMessages('梗概', '剧本', [char], [scene], [], [
      { title: '威胁接力反转', summary: '威胁逐级移交，反转在最后一环收口。' },
    ]);
    const user = String(withMech[1]!.content);
    expect(user).toContain('本集叙事机制锚');
    expect(user).toContain('◆ 威胁接力反转');
    const noMech = buildStoryboardMessages('梗概', '剧本', [char], [scene], []);
    expect(String(noMech[1]!.content)).not.toContain('本集叙事机制锚');
  });
});
