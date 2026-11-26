/**
 * 拆解环节的分集与锚点测试（设计共识 2026-11-26 第 3.2 节）
 * 重点：合并集列表时不丢已有内容——保留原 id、保留本集剧本等其余字段、挂镜头或已有剧本的旧集不被丢。
 */
import { describe, expect, it } from 'vitest';

import type { DuanjuEpisode } from '@shared/duanju';

import { buildBreakdownMessages, mergeEpisodes, parseBreakdown } from '../prompts-script';

function ep(index: number, overrides: Partial<DuanjuEpisode> = {}): DuanjuEpisode {
  return { id: `ep-old-${index}`, index, title: `旧标题${index}`, synopsis: `旧梗概${index}`, ...overrides };
}

describe('拆解系统词', () => {
  it('要求每集给厚梗概与原文首末句锚点，并说明锚点要逐字抄录', () => {
    const [system] = buildBreakdownMessages('第一集：到镇上。', 3);
    expect(system.content).toContain('150字内');
    expect(system.content).toContain('sourceStart');
    expect(system.content).toContain('sourceEnd');
    expect(system.content).toContain('逐字抄录');
  });
});

describe('parseBreakdown 的分集锚点', () => {
  it('解析 sourceStart / sourceEnd；缺失、空白、非字符串都省略；过长的截断', () => {
    const raw = JSON.stringify({
      summary: 's',
      eventChain: [],
      conflict: 'c',
      characterRelations: 'r',
      emotionPoints: [],
      visualActions: [],
      riskReplacements: [],
      episodes: [
        { index: 1, title: '一', synopsis: '甲', sourceStart: '铛——！', sourceEnd: '他才停下。' },
        { index: 2, title: '二', synopsis: '乙', sourceStart: '   ', sourceEnd: 42 },
        { index: 3, title: '三', synopsis: '丙', sourceStart: '长'.repeat(200) },
      ],
    });
    const parsed = parseBreakdown(raw)!;
    expect(parsed.episodes[0]).toEqual({ index: 1, title: '一', synopsis: '甲', sourceStart: '铛——！', sourceEnd: '他才停下。' });
    expect(parsed.episodes[1]).toEqual({ index: 2, title: '二', synopsis: '乙' });
    expect(parsed.episodes[2]!.sourceStart).toHaveLength(60);
    expect(parsed.episodes[2]!.sourceEnd).toBeUndefined();
  });
});

describe('mergeEpisodes 合并集列表', () => {
  const parsed = [
    { index: 1, title: '命纹灼烧', synopsis: '新梗概1', sourceStart: '铛——！', sourceEnd: '风吹过。' },
    { index: 3, title: '青麓开门', synopsis: '新梗概3' },
  ];

  it('已有集保留原 id 与其余字段（本集剧本不丢），更新标题、梗概与锚点', () => {
    const existing = [
      ep(1, { script: '场1 内·演武场·日\n……', scriptSource: 'adapted', scriptUpdatedAt: 5, mechanisms: ['hook'], sourceEnd: '旧末句' }),
    ];
    const [merged] = mergeEpisodes(existing, parsed, []);
    expect(merged).toEqual({
      id: 'ep-old-1',
      index: 1,
      title: '命纹灼烧',
      synopsis: '新梗概1',
      script: '场1 内·演武场·日\n……',
      scriptSource: 'adapted',
      scriptUpdatedAt: 5,
      mechanisms: ['hook'],
      sourceStart: '铛——！',
      sourceEnd: '风吹过。',
    });
  });

  it('新集新建 id 并带上锚点；模型没给锚点的集不带锚点字段', () => {
    const merged = mergeEpisodes([], parsed, []);
    expect(merged[0]!.id).toMatch(/^ep-\d+-1$/);
    expect(merged[0]!.sourceStart).toBe('铛——！');
    expect(merged[1]!.id).toMatch(/^ep-\d+-3$/);
    expect('sourceStart' in merged[1]!).toBe(false);
  });

  it('模型本次没提的旧集：挂了镜头或已有剧本的保留，两者都没有的丢弃', () => {
    const existing = [
      ep(1),
      ep(2), // 未提及、无镜头、无剧本 → 丢
      ep(4, { script: '用户写过的第 4 集' }), // 未提及、有剧本 → 留
      ep(5), // 未提及、有镜头 → 留
      ep(6, { script: '   ' }), // 空白剧本不算有 → 丢
    ];
    const shots = [{ episodeId: 'ep-old-5' }];
    const merged = mergeEpisodes(existing, [{ index: 1, title: '新一', synopsis: '' }], shots);
    expect(merged.map((e) => e.index)).toEqual([1, 4, 5]);
    expect(merged[1]!.script).toBe('用户写过的第 4 集');
  });
});
describe('改编式拆解（用户反馈 2026-11-24：粘贴的是故事素材，不是按原文切分的剧本）', () => {
  it('system 提示词要求「改编扩充」而非「按原文切分」，且短素材要扩充集数', () => {
    const [system] = buildBreakdownMessages('一段很短的故事素材。', 12);
    expect(system.content).toContain('改编扩充');
    expect(system.content).toContain('不是把它按原文切分');
  });

  it('user 消息向模型明确目标集数与改编要求', () => {
    const [, user] = buildBreakdownMessages('一段故事素材。', 12);
    expect(user.content).toContain('目标集数：12 集');
    expect(user.content).toContain('改编扩充成 12 集竖屏短剧');
    expect(user.content).toContain('不要照搬原文切分');
    expect(user.content).toContain('素材不够的地方合理扩充（加配角冲突、支线、细节）');
    expect(user.content).toContain('一段故事素材');
  });
});
