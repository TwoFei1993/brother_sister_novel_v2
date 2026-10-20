/**
 * 章节大纲解析单测（Word 导入实测反馈）：覆盖用户真实 docx 的巨型段落 + U+FEFF
 * 分隔形态、标准换行版、无标记版、「第198号书架」正文陷阱、卷标记、空文本、
 * 多份草稿章号重复取首次，以及生成联动 directive 与 settings 入库裁剪。
 */
import { describe, expect, it } from 'vitest';

import { chapterOutlineDirective, parseChapterOutlines, toChapterOutlineItems } from '../../outline/chapters';

/** 用户 docx 同构缩样：单个巨型段落，段内以 U+FEFF 分隔，标记独立"行" */
const DOCX_LIKE = [
  '标题：穿成嫡出大小姐的日常',
  '背景：穿成古代大家族嫡出大小姐。',
  '金手指：空间，只有女主知道。',
  '第一卷：胎穿藏锋，稚岁囤积（0-8岁）',
  '第1章 落地嫡长，方寸藏天机',
  '剧情',
  '女主胎穿清醒，顺利降生为镇国公府嫡长女。',
  '看点',
  '开局铺垫胎穿身份、隐藏金手指。',
  '小冲突',
  '刚出生被府中下人试探性情。',
  '第2章 稚子无声，私囤万千',
  '剧情',
  '女主幼年悄悄将吃食囤进时停仓库。',
  '看点',
  '未雨绸缪性格首次落地。',
  '小冲突',
  '乳母起疑被女主哭闹化解。',
].join('\uFEFF');

describe('parseChapterOutlines', () => {
  it('用户 docx 同构缩样：巨型段落 + FEFF 分隔 + 剧情/看点/小冲突全字段', () => {
    const out = parseChapterOutlines(DOCX_LIKE);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ index: 1, title: '落地嫡长，方寸藏天机', volume: '胎穿藏锋，稚岁囤积（0-8岁）' });
    expect(out[0]?.plot).toContain('镇国公府嫡长女');
    expect(out[0]?.highlight).toContain('隐藏金手指');
    expect(out[0]?.conflict).toContain('试探性情');
    expect(out[1]).toMatchObject({ index: 2, title: '稚子无声，私囤万千' });
    expect(out[1]?.plot).toContain('时停仓库');
  });

  it('标准换行版：行内标记与独立行标记均可解析', () => {
    const text = [
      '第1章 初入宗门',
      '剧情：少年拜入天玄宗，测出废灵根。',
      '看点：废灵根实为上古神体。',
      '小冲突：被同门讥讽。',
      '第3章 夜探藏经阁',
      '剧情 深夜潜入，偶见残卷。',
    ].join('\n');
    const out = parseChapterOutlines(text);
    expect(out.map((c) => c.index)).toEqual([1, 3]);
    expect(out[0]?.plot).toContain('废灵根');
    expect(out[0]?.highlight).toContain('上古神体');
    expect(out[0]?.conflict).toContain('讥讽');
    expect(out[1]?.title).toBe('夜探藏经阁');
    expect(out[1]?.plot).toContain('残卷');
  });

  it('无标记版：缺「剧情」标记时标题后的整段作为 plot', () => {
    const out = parseChapterOutlines('第5章 风雪归途\n他踏雪而行，身后是烧毁的山门。');
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('风雪归途');
    expect(out[0]?.plot).toContain('烧毁的山门');
    expect(out[0]?.highlight).toBeUndefined();
  });

  it('正文陷阱：「第198号书架」与「在第3章里」不切分为章节', () => {
    const text = '第1章 初见\n她在第198号书架前停步，想起在第3章里读过的残卷。全文至此。';
    const out = parseChapterOutlines(text);
    expect(out).toHaveLength(1);
    expect(out[0]?.index).toBe(1);
  });

  it('卷标记：归入其后最近的章节，卷内逐章继承归位', () => {
    const text = [
      '第一卷：京中扬名',
      '第1章 初露锋芒',
      '剧情：宴会上崭露头角。',
      '第二卷：暗流渐起',
      '第2章 夜访',
      '剧情：密信现世。',
    ].join('\n');
    const out = parseChapterOutlines(text);
    expect(out[0]?.volume).toBe('京中扬名');
    expect(out[1]?.volume).toBe('暗流渐起');
  });

  it('空文本容错：空串与纯空白返回空数组', () => {
    expect(parseChapterOutlines('')).toEqual([]);
    expect(parseChapterOutlines('   \n  ')).toEqual([]);
  });

  it('多份大纲草稿章号重复：取首次出现（真实 docx 含 3 份草稿）', () => {
    const text = [
      '第1章 落地嫡长',
      '剧情：胎穿嫡长女，隐藏空间。',
      '第2章 私囤万千',
      '剧情：幼年囤积物资。',
      '第1章 落地嫡长',
      '梗概：另一份草稿的写法。',
    ].join('\n');
    const out = parseChapterOutlines(text);
    expect(out.map((c) => c.index)).toEqual([1, 2]);
    expect(out[0]?.plot).toContain('隐藏空间');
  });

  it('行内章头：标记不换行的巨型段落（无任何换行分隔）同样可切', () => {
    const out = parseChapterOutlines('第1章 开局 剧情主角醒来。看点金手指初现。第2章 进城 剧情初入江湖。');
    expect(out.map((c) => c.index)).toEqual([1, 2]);
    expect(out[0]?.title).toBe('开局');
    expect(out[0]?.plot).toBe('主角醒来。');
    expect(out[0]?.highlight).toContain('金手指初现');
    expect(out[1]?.plot).toBe('初入江湖。');
  });
});

describe('chapterOutlineDirective / toChapterOutlineItems', () => {
  const items = [
    { index: 1, title: '落地嫡长', plot: '胎穿嫡长女' },
    { index: 2, title: '私囤万千', plot: '幼年囤积' },
  ];

  it('命中章号：返回带前导空行的本章大纲提示文本', () => {
    expect(chapterOutlineDirective(items, 1)).toBe('\n\n（本章大纲：标题《落地嫡长》；剧情要点：胎穿嫡长女）');
  });

  it('未命中/无大纲：返回空串', () => {
    expect(chapterOutlineDirective(items, 9)).toBe('');
    expect(chapterOutlineDirective(undefined, 1)).toBe('');
  });

  it('toChapterOutlineItems：裁剪为 index/title/plot 三字段', () => {
    const trimmed = toChapterOutlineItems([{ index: 1, title: 'a', plot: 'b', highlight: 'c', conflict: 'd', volume: 'e' }]);
    expect(trimmed).toEqual([{ index: 1, title: 'a', plot: 'b' }]);
  });
});
