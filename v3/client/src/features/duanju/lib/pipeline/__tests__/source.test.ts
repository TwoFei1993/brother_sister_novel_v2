/**
 * 原文性质推断、按集切片定位、本集剧本取值（设计共识 2026-11-26 第 3.3 节）
 *
 * 切片是两遍算法：第一遍逐集找「首句 + 末句」完整对（顺次搜索、前缀降级匹配）；
 * 第二遍给未定位的集按邻集夹出范围。重点覆盖降级、未定位、回退与越界。
 */
import { describe, expect, it } from 'vitest';

import type { DuanjuEpisode, DuanjuProject } from '@shared/duanju';
import { newDuanjuProject } from '@shared/duanju';

import {
  assembleEpisodeSource,
  effectiveEpisodeScript,
  hasEpisodeScript,
  inferScriptScope,
  scriptScopeOf,
  sliceEpisodes,
} from '../source';

describe('原文性质推断', () => {
  const heading = (n: string, unit = '章'): string => `\n第${n}${unit} 标题\n正文。\n`;

  it('行首出现 2 次及以上章节标题（章/回/节/卷，阿拉伯或中文数字）→ full', () => {
    expect(inferScriptScope(heading('1') + heading('2'))).toBe('full');
    expect(inferScriptScope(heading('一') + heading('二', '回'))).toBe('full');
    expect(inferScriptScope(heading('３', '节') + heading('十二', '卷'))).toBe('full');
  });

  it('「第 N 集」不算章节标题；只有 1 个标题不算', () => {
    expect(inferScriptScope(heading('1', '集') + heading('2', '集'))).toBe('episode1');
    expect(inferScriptScope(heading('9'))).toBe('episode1');
  });

  it('超过 1.5 万字 → full；否则 episode1；空白 → episode1', () => {
    expect(inferScriptScope('字'.repeat(15_001))).toBe('full');
    expect(inferScriptScope('字'.repeat(15_000))).toBe('episode1');
    expect(inferScriptScope('')).toBe('episode1');
  });
});

describe('按集切片定位', () => {
  const text = [
    '【一开头】甲一。甲二。甲三。【一结尾】',
    '【二开头】乙一。乙二。乙三。乙四。【二结尾】',
    '【三开头】丙一。丙二。【三结尾】',
    '【四开头】丁一。【四结尾】',
  ].join('\n');

  it('全部精确命中：范围是各自的首句到末句（含）', () => {
    const s = sliceEpisodes(text, [
      { sourceStart: '【一开头】', sourceEnd: '【一结尾】' },
      { sourceStart: '【二开头】', sourceEnd: '【二结尾】' },
      { sourceStart: '【三开头】', sourceEnd: '【三结尾】' },
      { sourceStart: '【四开头】', sourceEnd: '【四结尾】' },
    ]);
    expect(s.map((x) => x.mode)).toEqual(['exact', 'exact', 'exact', 'exact']);
    for (const x of s) expect(text.slice(x.from, x.to)).toMatch(/^【.+开头】.+【.+结尾】$/);
    expect(s[0]!.from).toBe(0);
    expect(s[3]!.to).toBe(text.length);
  });

  it('首句降级匹配：模型改写了首句后半 → 用前 12 / 8 / 5 个字仍能定位', () => {
    const s = sliceEpisodes(text, [
      { sourceStart: '【一开头】甲一。甲二。甲三。被我改写了', sourceEnd: '【一结尾】' },
      { sourceStart: '【二开头】乙一。乙二。乙三。乙四。改写', sourceEnd: '【二结尾】' },
      { sourceStart: '【三开头】丙一。丙二。改写', sourceEnd: '【三结尾】' },
      { sourceStart: '【四开头】', sourceEnd: '【四结尾】' },
    ]);
    expect(s.map((x) => x.mode)).toEqual(['exact', 'exact', 'exact', 'exact']);
    expect(s.map((x) => x.degraded)).toEqual([true, true, true, false]); // 第 4 集锚点没被改写
  });

  it('未定位的集：夹在前一个定位成功的集的末句与后一个定位成功的集的首句之间；相邻多个共用这一段', () => {
    const s = sliceEpisodes(text, [
      { sourceStart: '【一开头】', sourceEnd: '【一结尾】' },
      { sourceStart: '完全不存在的句子', sourceEnd: '也不存在' },
      { sourceStart: '还是不存在', sourceEnd: '找不到' },
      { sourceStart: '【四开头】', sourceEnd: '【四结尾】' },
    ]);
    expect(s.map((x) => x.mode)).toEqual(['exact', 'estimated', 'estimated', 'exact']);
    expect(text.slice(s[1]!.from, s[1]!.to)).toBe('【二开头】乙一。乙二。乙三。乙四。【二结尾】\n【三开头】丙一。丙二。【三结尾】');
    expect([s[2]!.from, s[2]!.to]).toEqual([s[1]!.from, s[1]!.to]);
  });

  it('首集之前 / 末集之后没有定位成功的邻集：左界文首、右界文末', () => {
    const s = sliceEpisodes(text, [
      { sourceStart: '不存在', sourceEnd: '不存在' },
      { sourceStart: '【二开头】', sourceEnd: '【二结尾】' },
      { sourceStart: '不存在', sourceEnd: '不存在' },
    ]);
    expect(s.map((x) => x.mode)).toEqual(['estimated', 'exact', 'estimated']);
    expect(text.slice(s[0]!.from, s[0]!.to)).toBe('【一开头】甲一。甲二。甲三。【一结尾】');
    expect(text.slice(s[2]!.from, s[2]!.to)).toBe('【三开头】丙一。丙二。【三结尾】\n【四开头】丁一。【四结尾】');
  });

  it('一个集都没定位 → 全部回退全文', () => {
    const s = sliceEpisodes(text, [
      { sourceStart: 'NoSuchStart1', sourceEnd: 'NoSuchEnd1' },
      { sourceStart: 'NoSuchStart2', sourceEnd: 'NoSuchEnd2' },
    ]);
    expect(s).toEqual([
      { index: 1, from: 0, to: text.length, mode: 'full', degraded: false },
      { index: 2, from: 0, to: text.length, mode: 'full', degraded: false },
    ]);
  });

  it('末句找不到或不晚于首句 → 该集未定位', () => {
    const s = sliceEpisodes(text, [
      { sourceStart: '【一开头】', sourceEnd: '【一开头】' }, // 末句不晚于首句
      { sourceStart: '【二开头】', sourceEnd: '根本找不到' }, // 末句找不到
      { sourceStart: '【三开头】', sourceEnd: '【三结尾】' },
    ]);
    expect(s.map((x) => x.mode)).toEqual(['estimated', 'estimated', 'exact']);
  });

  it('范围超过全文平均集长的 4 倍 → 按未定位处理（防降级匹配串到很靠后的位置）', () => {
    // 8 集、每集约 19 字：平均约 20 字，上限约 80 字。第 1 集的末句串到第 6 段末尾 → 范围远超上限
    const segs = Array.from({ length: 8 }, (_, i) => `【${i + 1}开头】内容${i + 1}。【${i + 1}结尾】`);
    const long = segs.join('\n');
    const s = sliceEpisodes(long, [
      { sourceStart: '【1开头】', sourceEnd: '【6结尾】' },
      ...segs.slice(1).map((_, i) => ({ sourceStart: `【${i + 2}开头】`, sourceEnd: `【${i + 2}结尾】` })),
    ]);
    expect(s[0]!.mode).toBe('estimated'); // 被第 2 集的首句夹住，不再吞掉后面五段
    expect(long.slice(s[0]!.from, s[0]!.to)).toBe(segs[0]);
    expect(s.slice(1).every((x) => x.mode === 'exact')).toBe(true);
  });

  it('顺次搜索：后一集只在前一集的末句之后找，同一句不会重复命中', () => {
    const s = sliceEpisodes(text, [
      { sourceStart: '【一开头】', sourceEnd: '【一结尾】' },
      { sourceStart: '【一开头】', sourceEnd: '【二结尾】' }, // 首句抄错成上一集的 → 在其后找不到 → 未定位
    ]);
    expect(s[0]!.mode).toBe('exact');
    expect(s[1]!.mode).toBe('estimated');
    expect(text.slice(s[0]!.to, s[1]!.from).trim()).toBe(''); // 紧接在第 1 集末句之后（只隔空白）
    expect(s[1]!.to).toBe(text.length);
  });

  it('锚点缺失（模型没给）→ 该集未定位；没有锚点的集不参与夹逼', () => {
    const s = sliceEpisodes(text, [
      { sourceStart: '', sourceEnd: '' },
      { sourceStart: '【二开头】', sourceEnd: '【二结尾】' },
    ]);
    expect(s.map((x) => x.mode)).toEqual(['estimated', 'exact']);
    expect(text.slice(s[0]!.from, s[0]!.to)).toBe('【一开头】甲一。甲二。甲三。【一结尾】');
  });
});

function projectOf(overrides: {
  text?: string;
  scope?: 'full' | 'episode1';
  episodes?: DuanjuEpisode[];
}): DuanjuProject {
  const p = newDuanjuProject({ targetEpisodes: 12, style: '动漫风', protagonists: '' }, 1);
  return {
    ...p,
    script: { ...p.script, text: overrides.text ?? '原文', ...(overrides.scope ? { scope: overrides.scope } : {}) },
    episodes: overrides.episodes ?? [],
  };
}

const EPISODE_TEXT = '第 1 章 出发\n小明出了门。\n第 2 章 到达\n小明到了。\n第 3 章 回家\n小明回了家。';

describe('本集剧本取值与原文性质', () => {
  it('已保存的 scope 优先；没有则按原文推断', () => {
    expect(scriptScopeOf(projectOf({ text: '短文本', scope: 'full' }))).toBe('full');
    expect(scriptScopeOf(projectOf({ text: EPISODE_TEXT }))).toBe('full');
    expect(scriptScopeOf(projectOf({ text: '只有第 1 集的短剧本' }))).toBe('episode1');
  });

  it('本集有剧本 → 用它；空白不算有剧本', () => {
    expect(hasEpisodeScript({ script: '  \n ' })).toBe(false);
    expect(hasEpisodeScript({ script: '正文' })).toBe(true);
    expect(hasEpisodeScript({})).toBe(false);
  });

  it('「只有第 1 集」的作品：第 1 集直接读原文，第 2 集起没有（要续写）', () => {
    const project = projectOf({
      text: '第 1 集的剧本正文',
      scope: 'episode1',
      episodes: [
        { id: 'a', index: 1, title: '一', synopsis: '' },
        { id: 'b', index: 2, title: '二', synopsis: '' },
      ],
    });
    expect(effectiveEpisodeScript(project, project.episodes[0]!)).toBe('第 1 集的剧本正文');
    expect(effectiveEpisodeScript(project, project.episodes[1]!)).toBeUndefined();
  });

  it('「整本小说」的作品：没写剧本的集不回退读全文（全文不是任何一集的剧本）', () => {
    const project = projectOf({ text: EPISODE_TEXT, scope: 'full', episodes: [{ id: 'a', index: 1, title: '一', synopsis: '' }] });
    expect(effectiveEpisodeScript(project, project.episodes[0]!)).toBeUndefined();
  });
});

describe('给提示词组装用的本集来源', () => {
  const eps: DuanjuEpisode[] = [
    { id: 'a', index: 1, title: '出发', synopsis: '出门', sourceStart: '第 1 章', sourceEnd: '小明出了门。', script: '第一集正文……结尾四个字' },
    { id: 'b', index: 2, title: '到达', synopsis: '到达目的地', sourceStart: '第 2 章', sourceEnd: '小明到了。' },
    { id: 'c', index: 3, title: '回家', synopsis: '回家吃饭', sourceStart: '第 3 章', sourceEnd: '小明回了家。' },
  ];

  it('整本小说：按锚点切片给本集原文，带上一集结尾与下一集梗概', () => {
    const project = projectOf({ text: EPISODE_TEXT, scope: 'full', episodes: eps });
    const src = assembleEpisodeSource(project, project.episodes[1]!);
    expect(src.mode).toBe('adapt');
    expect(src.source).toEqual({ text: '第 2 章 到达\n小明到了。', mode: 'exact', degraded: false });
    expect(src.prevTail).toBe('第一集正文……结尾四个字');
    expect(src.nextSynopsis).toBe('回家吃饭');
    expect(src.anchorsNote).toBe('');
    // 末集没有下一集
    expect(assembleEpisodeSource(project, project.episodes[2]!).nextSynopsis).toBeUndefined();
  });

  it('未定位的集：来源按邻集估算并在说明里注明，供提示词限定「只写本集」', () => {
    const project = projectOf({
      text: EPISODE_TEXT,
      scope: 'full',
      episodes: [
        { ...eps[0]!, sourceStart: '找不到的开头', sourceEnd: '找不到的结尾' },
        eps[1]!,
        eps[2]!,
      ],
    });
    const src = assembleEpisodeSource(project, project.episodes[0]!);
    expect(src.source?.mode).toBe('estimated');
    expect(src.source?.text).toBe('第 1 章 出发\n小明出了门。');
    expect(src.anchorsNote).toContain('按邻集位置估算');
  });

  it('整本小说但一个集都定位不到 → 回退全文并注明', () => {
    const project = projectOf({
      text: EPISODE_TEXT,
      scope: 'full',
      episodes: [
        { ...eps[0]!, sourceStart: 'x', sourceEnd: 'y' },
        { ...eps[1]!, sourceStart: 'z', sourceEnd: 'w' },
      ],
    });
    const src = assembleEpisodeSource(project, project.episodes[1]!);
    expect(src.source).toEqual({ text: EPISODE_TEXT, mode: 'full', degraded: false });
    expect(src.anchorsNote).toContain('未找到原文位置');
  });

  it('只有第 1 集：第 2 集起是续写——不给原文切片，给上一集结尾与下一集梗概；第 1 集不需要生成', () => {
    const project = projectOf({
      text: '第 1 集的剧本正文',
      scope: 'episode1',
      episodes: [
        { id: 'a', index: 1, title: '一', synopsis: '' },
        { id: 'b', index: 2, title: '二', synopsis: '第二集梗概' },
        { id: 'c', index: 3, title: '三', synopsis: '第三集梗概' },
      ],
    });
    const src = assembleEpisodeSource(project, project.episodes[1]!);
    expect(src.mode).toBe('continue');
    expect(src.source).toBeUndefined();
    expect(src.prevTail).toBe('第 1 集的剧本正文');
    expect(src.nextSynopsis).toBe('第三集梗概');
    const first = assembleEpisodeSource(project, project.episodes[0]!);
    expect(first.mode).toBe('continue');
    expect(first.skip).toBe(true); // 原文即第 1 集：不调 AI
  });
});
