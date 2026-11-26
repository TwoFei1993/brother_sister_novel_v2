/**
 * 分集剧本三种模式的提示词组装与产出校验（设计共识 2026-11-26 第 3.3 节）
 */
import { describe, expect, it } from 'vitest';

import type { DuanjuEpisode, DuanjuProject } from '@shared/duanju';
import { newDuanjuProject } from '@shared/duanju';

import { assembleEpisodeSource } from '../../pipeline/source';
import {
  buildAdaptMessages,
  buildContinueMessages,
  buildRewriteMessages,
  cleanEpisodeScript,
  validateEpisodeScript,
} from '../prompts-episode';
import { ADAPT_SYSTEM, CONTINUE_SYSTEM, REWRITE_SYSTEM } from '../prompts-episode-rules';

const NOVEL = '第 1 章 出发\n小明出了门。\n第 2 章 到达\n小明到了。\n第 3 章 回家\n小明回了家。';

function episode(index: number, overrides: Partial<DuanjuEpisode> = {}): DuanjuEpisode {
  return {
    id: `ep-${index}`,
    index,
    title: `标题${index}`,
    synopsis: `梗概${index}`,
    sourceStart: `第 ${index} 章`,
    sourceEnd: ['', '小明出了门。', '小明到了。', '小明回了家。'][index],
    ...overrides,
  };
}

function project(overrides: Partial<Pick<DuanjuProject, 'script' | 'episodes'>> = {}): DuanjuProject {
  const p = newDuanjuProject({ targetEpisodes: 12, style: '动漫风', protagonists: '' }, 1);
  return {
    ...p,
    reviewCards: { ...p.reviewCards, summary: '少年剑修夺魁', conflict: '祖剑之争', characterRelations: '师兄妹' },
    characters: [
      { id: 'c1', name: '陆惊尘', profile: `黑发高马尾，${'很长的档案'.repeat(20)}`, sheetImages: [], updatedAt: 1 },
      { id: 'c2', name: '沈青鸾', profile: '白上衣青绿百褶裙', sheetImages: [], updatedAt: 1 },
    ],
    scenes: [{ id: 's1', name: '比剑台', spec: `青灰石砖，${'很长的场景描述'.repeat(15)}`, images: [], updatedAt: 1 }],
    ...overrides,
  };
}

type Messages = Array<{ role: string; content: string }>;
const split = (m: Messages): [string, string] => [m[0]!.content, m[1]!.content];
const userOf = (m: Messages): string => m[1]!.content;

describe('改编：从原文切片', () => {
  const ep = episode(2);
  const p = project({ script: { source: 'pasted', text: NOVEL, confirmed: true, scope: 'full', updatedAt: 1 }, episodes: [episode(1), ep, episode(3)] });

  it('系统词是改编纪律；用户消息带审核卡、人物与场景清单（截断）、本集梗概与原文切片', () => {
    const [system, user] = split(buildAdaptMessages(p, ep, assembleEpisodeSource(p, ep)));
    expect(system).toBe(ADAPT_SYSTEM);
    expect(system).toContain('忠实原文');
    expect(user).toContain('剧情概括：少年剑修夺魁');
    expect(user).toContain('- 陆惊尘：黑发高马尾，');
    expect(user).not.toContain('很长的档案'.repeat(20)); // 档案截断，不整段带入
    expect(user).toContain('- 比剑台：青灰石砖，');
    expect(user).toContain('第 2 集《标题2》');
    expect(user).toContain('本集梗概：梗概2');
    expect(user).toContain('下一集梗概（不要写进去）：梗概3');
    expect(user).toContain(`【本集对应原文】\n第 2 章 到达\n小明到了。`);
    expect(user).not.toContain('小明回了家'); // 别的集的原文不进来
    expect(user).toContain('请输出第 2 集完整剧本');
  });

  it('上一集已有剧本时带它的结尾做开场承接', () => {
    const p2 = project({
      script: { source: 'pasted', text: NOVEL, confirmed: true, scope: 'full', updatedAt: 1 },
      episodes: [episode(1, { script: '第一集正文', scriptSource: 'adapted' }), ep],
    });
    const user = userOf(buildAdaptMessages(p2, ep, assembleEpisodeSource(p2, ep)));
    expect(user).toContain('上一集结尾（开场承接它的状态，不复述）：\n…第一集正文');
    expect(user).not.toContain('下一集梗概'); // 没有下一集就不带
  });

  it('未定位的集：范围说明进提示词，限定只写本集', () => {
    const p3 = project({
      script: { source: 'pasted', text: NOVEL, confirmed: true, scope: 'full', updatedAt: 1 },
      episodes: [episode(1), episode(2, { sourceStart: '找不到', sourceEnd: '找不到' }), episode(3)],
    });
    const user = userOf(buildAdaptMessages(p3, p3.episodes[1]!, assembleEpisodeSource(p3, p3.episodes[1]!)));
    expect(user).toContain('范围说明：未找到本集在原文中的确切位置');
    expect(user).toContain('只写本集梗概对应的情节');
  });
});

describe('续写：按梗概', () => {
  const p = project({
    script: { source: 'pasted', text: '第 1 集的剧本正文', confirmed: true, scope: 'episode1', updatedAt: 1 },
    episodes: [
      episode(1),
      episode(2),
      episode(3, { script: '第三集正文开头\n场2 对白\n结尾', scriptSource: 'continued', scriptUpdatedAt: 9 }),
      episode(4),
    ],
  });

  it('系统词是续写纪律；用户消息带前文剧本全文（第 1 集读原文）与格式范例，不带原文切片', () => {
    const ep = p.episodes[1]!;
    const [system, user] = split(buildContinueMessages(p, ep, assembleEpisodeSource(p, ep)));
    expect(system).toBe(CONTINUE_SYSTEM);
    expect(system).toContain('不越界');
    expect(user).toContain(`【最近剧本（全文）】\n第 1 集《标题1》：\n第 1 集的剧本正文`);
    expect(user).toContain('【前文格式范例】');
    expect(user).toContain('第 1 集的剧本正文'); // 第 1 集没有另存剧本：格式范例也取自原文
    expect(user).not.toContain('【本集对应原文】');
  });

  it('最近两集全文 + 更早各集只带结尾', () => {
    const ep = p.episodes[3]!;
    const user = userOf(buildContinueMessages(p, ep, assembleEpisodeSource(p, ep)));
    expect(user).toContain('第 3 集《标题3》：\n第三集正文开头');
    expect(user).toContain(`【前文格式范例】（排版与写法照此）\n第三集正文开头`);
    expect(user).not.toContain('【更早各集结尾】'); // 只有 2 集前文：全部全文带入
  });
});

describe('重写：按作者意见', () => {
  it('系统词是重写纪律；用户消息带现有剧本与意见，不带原文', () => {
    const p = project({ script: { source: 'pasted', text: NOVEL, confirmed: true, scope: 'full', updatedAt: 1 }, episodes: [episode(1)] });
    const [system, user] = split(
      buildRewriteMessages(p, p.episodes[0]!, '场1 内·比剑台·日\n陆惊尘：拔剑吧。', '场2 的对白太生硬，改得口语一些'),
    );
    expect(system).toBe(REWRITE_SYSTEM);
    expect(system).toContain('只改修改意见涉及的部分');
    expect(user).toContain('【作者修改意见】\n场2 的对白太生硬，改得口语一些');
    expect(user).toContain('【本集现有剧本】\n场1 内·比剑台·日\n陆惊尘：拔剑吧。');
    expect(user).not.toContain('小明出了门');
  });
});

describe('产出清洗与校验', () => {
  it('剥代码块围栏与首尾解释行', () => {
    expect(cleanEpisodeScript('```\n场1 内·比剑台·日\n正文\n```\n\n希望符合预期')).toBe('场1 内·比剑台·日\n正文');
    expect(cleanEpisodeScript('以下是第 2 集剧本：\n场1 外·山道·日\n正文')).toBe('场1 外·山道·日\n正文');
  });

  it('空 / 过短 → 人话原因；正常 → null', () => {
    expect(validateEpisodeScript('  \n ')).toBe('模型没有输出剧本');
    expect(validateEpisodeScript('短'.repeat(199))).toContain('剧本过短');
    expect(validateEpisodeScript('字'.repeat(200))).toBeNull();
  });
});
