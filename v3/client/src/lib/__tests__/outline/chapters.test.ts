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

  // 用户真实 docx（【原创短剧】嫡出大小姐）3 章缩样脱敏仿制：单个巨型段落（无 \n），
  // U+FEFF 分隔，「剧情/看点/小冲突」独立成"行"（FEFF 后），末尾跟下一个卷标记。
  const DOCX_REAL_LIKE = [
    '标题：穿成相府嫡女的日常',
    '背景：穿成古代大家族嫡出大小姐，胎穿。',
    '金手指：随身空间，只有女主一人知晓。',
    '第一卷：稚岁藏锋（0-8岁）',
    '第1章 落地嫡长，方寸藏天机',
    '剧情',
    '女主胎穿清醒，从母体感知这一世顶级家世，顺利降生为相府嫡长女。',
    '看点',
    '开局铺垫胎穿身份、隐藏金手指，奠定早熟沉静人设。',
    '小冲突',
    '府中下人试探性情，女主全程隐忍伪装普通婴孩。',
    '第2章 稚子无声，私囤万千',
    '剧情',
    '女主幼年借玩耍为由，悄悄将吃食药材小物件全部囤进时停仓库。',
    '看点',
    '未雨绸缪性格首次落地，从小养成囤积习惯。',
    '小冲突',
    '乳母起疑，被女主哭闹化解。',
    '第3章 父母偏爱，高门安稳局',
    '剧情',
    '通过日常相处展现父母联姻的和睦格局，女主看清家族权力结构，划分亲人亲疏。',
    '看点',
    '铺垫全书最大靠山：家庭绝对稳固。',
    '小冲突',
    '旁支长辈想借幼童拿捏嫡房，被父母不动声色挡回。',
  ].join('﻿');

  it('真实 docx 3 章缩样（FEFF 巨段 + 独立标记行）：各章 plot 均含「剧情」段细节，非仅标题', () => {
    const out = parseChapterOutlines(DOCX_REAL_LIKE);
    expect(out.map((c) => c.index)).toEqual([1, 2, 3]);
    expect(out[0]?.title).toBe('落地嫡长，方寸藏天机');
    expect(out[0]?.plot).toContain('相府嫡长女');
    expect(out[0]?.plot.length).toBeGreaterThanOrEqual(15);
    expect(out[0]?.highlight).toContain('隐藏金手指');
    expect(out[0]?.conflict).toContain('隐忍');
    expect(out[1]?.plot).toContain('时停仓库');
    expect(out[1]?.conflict).toContain('哭闹化解');
    expect(out[2]?.plot).toContain('权力结构');
    // 全章 volume 均为「其后最近章节之前的卷标记」——第一卷
    expect(out.every((c) => c.volume === '稚岁藏锋（0-8岁）')).toBe(true);
  });

  it('末章缺「小冲突」+ 尾部卷标记：字段取文在卷标记处截断，不吞入「第二卷：…」文本', () => {
    // 真实 docx 第 8 章形态：只有 剧情+看点，其后紧跟下一卷标记
    const text = [
      '第8章 初藏产业，小小家底',
      '剧情',
      '女主借长辈赏赐悄悄积累第一笔私财，空间仓库开始大批量囤积物资。',
      '看点',
      '从小建立经济独立，为后期掌权势铺垫。',
      '第二卷：豆蔻初显，风华暗藏（9-14岁）',
      '第9章 名师入府，技压众长',
      '剧情',
      '父母重金请来各界名师，女主私下靠空间翻倍练习。',
    ].join('﻿');
    const out = parseChapterOutlines(text);
    expect(out.map((c) => c.index)).toEqual([8, 9]);
    expect(out[0]?.highlight).toBe('从小建立经济独立，为后期掌权势铺垫。');
    expect(out[0]?.highlight).not.toContain('第二卷');
    expect(out[0]?.conflict).toBeUndefined();
    expect(out[1]?.volume).toBe('豆蔻初显，风华暗藏（9-14岁）'); // 卷标记仍正确归属下一章
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
