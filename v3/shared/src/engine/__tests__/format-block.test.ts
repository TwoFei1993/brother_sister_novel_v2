/**
 * 内容形态规范块测试（用户需求 2026-11-24：番茄小短篇/红果短剧剧本/电影/电视剧剧本等——
 * 形态决定体量目标、结构规范与格式指令，注入每次生成；default 不注入）。
 */
import { describe, expect, it } from 'vitest';

import { buildFormatBlock, formatTemplate } from '../prompt/novel/format-block';
import { pickChapterRequirement } from '../prompt/novel/requirements';

describe('buildFormatBlock', () => {
  it('default/未指定 → 空串（不注入）', () => {
    expect(buildFormatBlock(undefined)).toBe('');
    expect(buildFormatBlock('default')).toBe('');
  });

  it('红果短剧剧本：注入场景标注/动作对白交替/集末钩子的剧本格式规范', () => {
    const block = buildFormatBlock('script_hongguo');
    expect(block).toContain('【内容形态：红果短剧剧本（硬性要求');
    expect(block).toContain('场景标注');
    expect(block).toContain('动作描述 + 角色对白');
    expect(block).toContain('悬念钩');
    expect(block).toContain('体量与结构');
  });

  it('番茄小短篇：注入完结体结构与快节奏格式', () => {
    const block = buildFormatBlock('fanqie_short');
    expect(block).toContain('【内容形态：番茄小短篇（硬性要求');
    expect(block).toContain('8-12 章');
    expect(block).toContain('完结章必须回收全部伏笔');
  });

  it('电影剧本：三幕结构与标准剧本格式', () => {
    const block = buildFormatBlock('script_movie');
    expect(block).toContain('【内容形态：电影剧本（硬性要求');
    expect(block).toContain('三幕结构');
    expect(block).toContain('场景头');
  });
});

describe('formatTemplate（UI 建书联动）', () => {
  it('default → null', () => {
    expect(formatTemplate('default')).toBeNull();
  });

  it('形态模板：字数/章节数与预设一致', () => {
    const hongguo = formatTemplate('script_hongguo');
    expect(hongguo?.chapterWords).toBe(500);
    expect(hongguo?.chapters).toBe(80);
    const qidian = formatTemplate('novel_qidian');
    expect(qidian?.chapterWords).toBe(3600);
    expect(qidian?.chapters).toBe(0);
  });
});

describe('pickChapterRequirement 形态透传（组装层只调它——透传断链则形态块进不了提示词）', () => {
  const MARK = '【内容形态：红果短剧剧本';
  const fmt = 'script_hongguo' as const;

  it('常规轮 / 续写轮 / 分段续写轮 / 扩写轮 都带形态块', () => {
    expect(pickChapterRequirement({ targetWords: 500, format: fmt })).toContain(MARK);
    expect(pickChapterRequirement({ targetWords: 500, format: fmt, continuation: true })).toContain(MARK);
    expect(
      pickChapterRequirement({ targetWords: 500, format: fmt, continuation: true, segment: { part: 2, parts: 3, words: 500 } }),
    ).toContain(MARK);
    expect(pickChapterRequirement({ targetWords: 500, format: fmt, expandChapter: true })).toContain(MARK);
  });

  it('default / 未指定 → 不含形态块', () => {
    expect(pickChapterRequirement({ targetWords: 500, format: 'default' })).not.toContain('【内容形态');
    expect(pickChapterRequirement({ targetWords: 500 })).not.toContain('【内容形态');
  });

  it('形态块位于要求块标题之前（最高位）', () => {
    const req = pickChapterRequirement({ targetWords: 500, format: fmt });
    expect(req.indexOf('【内容形态：')).toBeGreaterThanOrEqual(0);
    expect(req.indexOf('【内容形态：')).toBeLessThan(req.indexOf('【本章写作要求】'));
  });
});
