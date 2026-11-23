/**
 * buildStyleExecution 文风执行块测试（A/B 实测驱动：文风从十几个字的标签升级为写法级指令）。
 * 背景：同设定同指令各风格跑 2 次，旧标签版「起点句子利落」实测句子更长、「番茄段落短」与无指令无差别。
 */
import { describe, expect, it } from 'vitest';

import { buildStyleExecution, WRITING_STYLE_GUIDE } from '../prompt/novel/requirements';

describe('buildStyleExecution 文风指令', () => {
  it('无基调无文风 → 空串（不注入）', () => {
    expect(buildStyleExecution({ tones: [], style: '' })).toBe('');
    expect(buildStyleExecution({ tones: [], style: '', writingStyle: 'default' })).toBe('');
  });

  it('三种内置风格各自注入中文标签 + 专属写法指令', () => {
    const qidian = buildStyleExecution({ tones: [], style: '', writingStyle: 'qidian' });
    const jjwxc = buildStyleExecution({ tones: [], style: '', writingStyle: 'jjwxc' });
    const fanqie = buildStyleExecution({ tones: [], style: '', writingStyle: 'fanqie' });
    expect(qidian).toContain('文风「起点·男频爽文」（全文执行）');
    expect(qidian).toContain('至少落一个可感的爽点');
    expect(jjwxc).toContain('文风「晋江·言情细腻」（全文执行）');
    expect(jjwxc).toContain('对话写潜台词');
    expect(fanqie).toContain('文风「番茄·快节奏」（全文执行）');
    expect(fanqie).toContain('单段不超过三句');
  });

  it('三种内置风格在句长/段长约束上互斥（可被 A/B 指标检验）', () => {
    expect(WRITING_STYLE_GUIDE.qidian).toContain('单句尽量不超过二十字');
    expect(WRITING_STYLE_GUIDE.fanqie).toContain('平均不超过十五字');
    expect(WRITING_STYLE_GUIDE.fanqie).toContain('单段不超过三句');
    expect(WRITING_STYLE_GUIDE.jjwxc).toContain('句子长短交错');
    expect(WRITING_STYLE_GUIDE.jjwxc).not.toContain('不超过');
    expect(WRITING_STYLE_GUIDE.qidian).toContain('心理点到即止');
    expect(WRITING_STYLE_GUIDE.jjwxc).toContain('关键情绪要写透');
  });

  it('自定义文风原文以「全文每一句都须遵循」强度透传', () => {
    const out = buildStyleExecution({ tones: [], style: '冷峻克制的武侠笔触', writingStyle: 'custom' });
    expect(out).toContain('文风规范（全文每一句都须遵循）：冷峻克制的武侠笔触');
    expect(out).not.toContain('叙事语言质感');
  });

  it('执行块置于最高优先级标题下，基调行在前', () => {
    const out = buildStyleExecution({ tones: ['热血爽文'], style: '', writingStyle: 'qidian' });
    expect(out.startsWith('【基调与文风（最高优先级）】\n- 基调「热血爽文」')).toBe(true);
    expect(out.indexOf('基调「热血爽文」')).toBeLessThan(out.indexOf('文风「起点'));
  });
});
