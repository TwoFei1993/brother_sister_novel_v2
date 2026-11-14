/**
 * 深度测试（drama-skills 对照轮）：P0 机检边界穷尽 + P2 状态/道具边界 + v3 prompt 组合矩阵
 */
import { describe, expect, it } from 'vitest';

import {
  activeStates,
  buildFramePrompt,
  parseStoryboard,
  propAnchorLine,
  validateStoryboardIssues,
} from '../prompts/prompts-storyboard';
import { buildLocalVideoPrompt, styleGuardOf } from '../prompts/prompts-video';
import type { DuanjuCharacter, DuanjuProject, DuanjuShot } from '@shared/duanju';

const NOW = 1700000000000;

const baseChar = (id: string, name: string): DuanjuCharacter => ({
  id, name, profile: '测试档案', sheetImages: [], refImageId: null, updatedAt: 1,
});

const makeShot = (o: Partial<DuanjuShot> = {}): DuanjuShot => ({
  id: 's1', episodeId: 'ep1', index: 1, shotSize: '中景', cameraMove: '固定',
  actionStart: '起', actionEnd: '终', staging: '', dialog: '',
  gridParts: [], gridPrompt: '', frames: [], characterIds: [], propIds: [],
  sceneId: null, updatedAt: NOW, ...o,
});

const makeProject = (o: Partial<DuanjuProject> = {}): DuanjuProject => ({
  revision: 1,
  script: { source: 'manual', text: '', confirmed: true, updatedAt: 1 },
  reviewCards: { summary: '', eventChain: [], conflict: '', characterRelations: '', emotionPoints: [], visualActions: [], riskReplacements: [] },
  style: '动漫风', targetEpisodes: 12, protagonists: '',
  characters: [], scenes: [], props: [],
  episodes: [{ id: 'ep1', index: 1, title: '一', synopsis: '' }],
  shots: [], spendLog: [], createdAt: NOW, updatedAt: NOW, ...o,
});

// ---------- P0：对白预算边界穷尽 ----------

describe('对白预算机检（4字/秒，扣 2s 开口等待）', () => {
  it('边界值：4s 镜容量 floor(2*4.1)=8——8 字过、9 字警', () => {
    const ok = validateStoryboardIssues([makeShot({ durationSec: 4, dialog: '一二三四五六七八', speaker: '甲' })]);
    expect(ok.filter((i) => i.includes('台词'))).toHaveLength(0);
    const over = validateStoryboardIssues([makeShot({ durationSec: 4, dialog: '一二三四五六七八九', speaker: '甲' })]);
    expect(over.some((i) => i.includes('S1 台词 9 字超出 4s 镜头容量（约 8 字'))).toBe(true);
  });

  it('纯标点台词不算可发声字（speakable=0 不警）；全空台词不触发', () => {
    const punct = validateStoryboardIssues([makeShot({ durationSec: 4, dialog: '，。！？……', speaker: '甲' })]);
    expect(punct.filter((i) => i.includes('台词'))).toHaveLength(0);
  });

  it('时长不足开口窗口（≤2s）且有台词 → 必须加时长分支', () => {
    const r = validateStoryboardIssues([makeShot({ durationSec: 2, dialog: '喂', speaker: '甲' })]);
    expect(r.some((i) => i.includes('开口等待后无发声窗口'))).toBe(true);
  });

  it('durationSec 缺省不检查预算（旧数据兼容）', () => {
    const r = validateStoryboardIssues([makeShot({ dialog: '这是一段非常长的台词超过任何容量', speaker: '甲' })]);
    expect(r.filter((i) => i.includes('台词'))).toHaveLength(0);
  });

  it('15s 长镜容量 53 字——长台词在长镜合法', () => {
    const long = '一'.repeat(53);
    const r = validateStoryboardIssues([makeShot({ durationSec: 15, dialog: long, speaker: '甲' })]);
    expect(r.filter((i) => i.includes('台词超出'))).toHaveLength(0);
  });
});

describe('speaker 机检', () => {
  it('有台词无 speaker 警告；空格台词不警；有 speaker 不警', () => {
    expect(validateStoryboardIssues([makeShot({ dialog: '快跑' })]).some((i) => i.includes('未标说话人'))).toBe(true);
    expect(validateStoryboardIssues([makeShot({ dialog: '  ' })]).some((i) => i.includes('未标说话人'))).toBe(false);
    expect(validateStoryboardIssues([makeShot({ dialog: '快跑', speaker: '甲' })]).some((i) => i.includes('未标说话人'))).toBe(false);
  });
});

describe('钩子密度机检（回归）', () => {
  it('5 镜中间 3 连无强钩 → 补钩警告；首末镜必带', () => {
    const hooks = ['reveal', 'suspense', 'suspense', 'suspense', 'callback'];
    const r = validateStoryboardIssues(
      hooks.map((h, i) => makeShot({ index: i + 1, hookType: h, gridParts: [], dialog: '', durationSec: 5 })),
    );
    expect(r.some((i) => i.includes('无强钩子'))).toBe(true);
  });
});

// ---------- P2：状态/道具边界 ----------

describe('activeStates 边界', () => {
  it('fromEpisode 恰等于当前集 → 生效（含边界）', () => {
    const c = { states: [{ fromEpisode: 3, note: '绷带' }] };
    expect(activeStates(c, 3)).toEqual(['绷带']);
    expect(activeStates(c, 2)).toEqual([]);
  });
  it('states undefined / 空数组安全', () => {
    expect(activeStates({}, 5)).toEqual([]);
    expect(activeStates({ states: [] }, 5)).toEqual([]);
  });
  it('多条混合按声明顺序输出', () => {
    const c = { states: [{ note: '耳环' }, { fromEpisode: 2, note: '血迹' }, { fromEpisode: 9, note: ' scar' }] };
    expect(activeStates(c, 2)).toEqual(['耳环', '血迹']);
    expect(activeStates(c, 10)).toEqual(['耳环', '血迹', ' scar']);
  });
});

describe('propAnchorLine 边界', () => {
  it('多道具全拼接；引用不存在的 id 跳过；propIds undefined 安全', () => {
    const proj = makeProject({
      props: [
        { id: 'p1', name: '怀表', spec: '黄铜壳', images: [], updatedAt: 1 },
        { id: 'p2', name: '手机', spec: '翻盖银色', images: [], updatedAt: 1 },
      ],
    });
    const line = propAnchorLine({ propIds: ['p1', 'ghost', 'p2'] }, proj);
    expect(line).toContain('怀表（黄铜壳）');
    expect(line).toContain('手机（翻盖银色）');
    expect(line).not.toContain('ghost');
    expect(propAnchorLine({} as Pick<DuanjuShot, 'propIds'>, proj)).toBe('');
  });
});

describe('parseStoryboard 脏数据（speaker/onScreenText/props/durationSec）', () => {
  const proj = makeProject({
    characters: [baseChar('c1', '甲'), baseChar('c2', '乙')],
    props: [{ id: 'p1', name: '怀表', spec: 'x', images: [], updatedAt: 1 }],
  });

  it('speaker 数字类型被安全忽略（str() → undefined）；props 非数组忽略', () => {
    const raw = '[{"shotSize":"中景","dialog":"喂","speaker":42,"props":"not-array","characters":["甲"]}]';
    const shots = parseStoryboard(raw, 'ep1', proj);
    expect(shots[0].speaker).toBeUndefined();
    expect(shots[0].propIds).toEqual([]);
  });

  it('正常输出：speaker/onScreenText/props 名映射全链', () => {
    const raw = '[{"shotSize":"近景","dialog":"站住","speaker":"乙","onScreenText":"门牌 402","props":["怀表","未知道具"],"characters":["甲","乙"]}]';
    const shots = parseStoryboard(raw, 'ep1', proj);
    expect(shots[0].speaker).toBe('乙');
    expect(shots[0].onScreenText).toBe('门牌 402');
    expect(shots[0].propIds).toEqual(['p1']);
    expect(shots[0].characterIds).toEqual(['c1', 'c2']);
  });

  it('durationSec 浮点四舍五入（4.7→5）；<1 越界回退 undefined', () => {
    const raw = '[{"shotSize":"中景","durationSec":4.7}]';
    expect(parseStoryboard(raw, 'ep1', proj)[0].durationSec).toBe(5);
    const raw0 = '[{"shotSize":"中景","durationSec":0.4}]';
    expect(parseStoryboard(raw0, 'ep1', proj)[0].durationSec).toBeUndefined();
  });
});

// ---------- v3 prompt 组合矩阵 ----------

describe('buildLocalVideoPrompt v3 组合矩阵', () => {
  const four = ['起手', '进行', '高潮', '收势'];

  it('双人一人说话：另一人单数语法 does/lips their', () => {
    const p = buildLocalVideoPrompt(
      makeShot({ gridParts: [...four], durationSec: 8, dialog: '走开', speaker: '甲' }),
      [baseChar('c1', '甲'), baseChar('c2', '乙')],
    );
    expect(p).toContain('甲 (S1)');
    expect(p).toContain('乙 does not speak');
    expect(p).toContain('lips remain completely closed');
  });

  it('三人两人不说话：A and B do ... their 复数语法', () => {
    const p = buildLocalVideoPrompt(
      makeShot({ gridParts: [...four], durationSec: 8, dialog: '走开', speaker: '甲' }),
      [baseChar('c1', '甲'), baseChar('c2', '乙'), baseChar('c3', '丙')],
    );
    expect(p).toContain('乙 and 丙 do not speak');
    expect(p).toContain('their lips remain completely closed');
  });

  it('speaker 为第二角色时其余全部闭嘴（含 chars[0]）', () => {
    const p = buildLocalVideoPrompt(
      makeShot({ gridParts: [...four], durationSec: 8, dialog: '嗯', speaker: '乙' }),
      [baseChar('c1', '甲'), baseChar('c2', '乙')],
    );
    expect(p).toContain('乙 (S1)');
    expect(p).toContain('甲 does not speak');
  });

  it('speaker 不在出场角色（手填错名）：others 覆盖全部出场角色', () => {
    const p = buildLocalVideoPrompt(
      makeShot({ gridParts: [...four], durationSec: 8, dialog: '喂', speaker: '路人' }),
      [baseChar('c1', '甲'), baseChar('c2', '乙')],
    );
    expect(p).toContain('路人 (S1)');
    expect(p).toContain('甲 and 乙 do not speak');
  });

  it('t2v 守护句必须是全文第一行；与锁面/画内文字共存不冲突', () => {
    const p = buildLocalVideoPrompt(
      makeShot({ gridParts: [...four], durationSec: 6, dialog: '', onScreenText: 'ON AIR' }),
      [{ ...baseChar('c1', '甲'), lockPhrase: 'red scarf, grey coat' }],
      { textToVideo: true, styleGuard: 'A 2D hand-drawn anime animation' },
    );
    expect(p.split('\n')[0]).toBe('A 2D hand-drawn anime animation, not live-action, not photographed, no real actors.');
    expect(p).toContain('[Continuity locks] red scarf, grey coat');
    expect(p).toContain('"ON AIR"');
  });

  it('最小镜头（无角色无台词无画内文字）不产生空段', () => {
    const p = buildLocalVideoPrompt(makeShot({ gridParts: [...four], durationSec: 5, dialog: '' }));
    expect(p).not.toContain('[Character spec]');
    expect(p).not.toContain('[Continuity locks]');
    expect(p).not.toContain('speaks');
    expect(p).toContain('non_diegetic_music: N/A');
    expect(p.split('\n').every((l) => l.trim().length > 0)).toBe(true);
  });
});

describe('styleGuardOf 画风映射', () => {
  it('五种内置 + 自定义兜底', () => {
    expect(styleGuardOf('动漫风')).toContain('2D hand-drawn anime');
    expect(styleGuardOf('水墨')).toContain('ink-wash');
    expect(styleGuardOf('赛博机械风')).toBe('A 2D animation');
  });
});

// ---------- buildFramePrompt 深度 ----------

describe('buildFramePrompt 状态/道具/画内文字注入', () => {
  const proj = makeProject({
    episodes: [
      { id: 'ep1', index: 1, title: '一', synopsis: '' },
      { id: 'ep5', index: 5, title: '五', synopsis: '' },
    ],
    characters: [{ ...baseChar('c1', '甲'), states: [{ fromEpisode: 3, note: '右手缠绷带' }], lockPhrase: 'silver hair' }],
    props: [{ id: 'p1', name: '旧怀表', spec: '黄铜壳链绳磨白', images: [], updatedAt: 1 }],
  });

  it('第 1 集 shot 不注入 fromEpisode=3 的状态；第 5 集注入', () => {
    const ep1 = buildFramePrompt(makeShot({ episodeId: 'ep1', characterIds: ['c1'] }), 1, proj);
    expect(ep1).not.toContain('绷带');
    const ep5 = buildFramePrompt(makeShot({ episodeId: 'ep5', characterIds: ['c1'] }), 1, proj);
    expect(ep5).toContain('【当前状态】');
    expect(ep5).toContain('右手缠绷带');
  });

  it('转身检测词命中才加半程姿态句；普通动作不加', () => {
    const turn = buildFramePrompt(makeShot({ gridParts: ['她猛地回身看向门口'] }), 1, makeProject());
    expect(turn).toContain('转身进行到一半');
    const still = buildFramePrompt(makeShot({ gridParts: ['她低头看信'] }), 1, makeProject());
    expect(still).not.toContain('转身进行到一半');
  });

  it('画内文字载体判定：手机屏 vs 实体表面', () => {
    const phone = buildFramePrompt(makeShot({ gridParts: ['a'], onScreenText: '手机聊天：今晚八点' }), 1, makeProject());
    expect(phone).toContain('的手机/电子屏幕');
    const sign = buildFramePrompt(makeShot({ gridParts: ['a'], onScreenText: '招牌：仁心诊所' }), 1, makeProject());
    expect(sign).toContain('的实体表面');
    expect(sign).not.toContain('手机');
  });

  it('refMode + triRef 全量组装：状态/道具/锁面/画内文字共存', () => {
    const p = buildFramePrompt(
      makeShot({ episodeId: 'ep5', characterIds: ['c1'], propIds: ['p1'], onScreenText: '402' }),
      2,
      proj,
      { refMode: true, triRef: true },
    );
    expect(p).toContain('右手缠绷带');
    expect(p).toContain('旧怀表（黄铜壳链绳磨白）');
    expect(p).toContain('silver hair');
    expect(p).toContain('「402」');
  });
});
