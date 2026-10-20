/**
 * 批量人设展板解析单测：以手写仿制缩样（全局段/分部标题/跨条目重复模板）覆盖
 * 条目切分、名字身份提取、模板去重、分部归组、年龄提取与非编号文档回退。
 */
import { describe, expect, it } from 'vitest';

import { extractFromOutline } from '../../outline/wizard';
import {
  buildSheetCardDraft,
  buildSheetWorldbookDraft,
  parseCharacterSheet,
  parseSheetDocument,
} from '../../outline/sheet';

/** 仿制人设展板缩样：头部版式与尾部画质词为跨条目重复模板，06 尾词与描述同行 */
const SHEET = `【全局统一】通用负面提示词：低分辨率， 模糊重影， 多余肢体， 文字水印， 画面过曝。
【全局统一】固定版式模板：漫剧角色人物设定展板， 竖版构图， 角色居中， 顶部标题栏， 底部信息条， 侧面坐姿。

第一部分：核心主角团
01. 沈青鸢｜镇北侯府嫡长女（女主，重生者）
正向 prompt：
漫剧角色人物设定展板， 竖版构图， 角色居中， 顶部标题栏， 底部信息条， 侧面坐姿。
18 岁少女， 身量挺拔， 玄色劲装束腰， 剑眉星目， 性格飒爽果决， 外冷内热。
国风淡彩厚涂漫画， 笔触细腻， 光影柔和， 8K 高清， 展板。
02. 陆云舟｜寒门出身的年轻谋士（男主）
正向 prompt：
漫剧角色人物设定展板， 竖版构图， 角色居中， 顶部标题栏， 底部信息条， 侧面坐姿。
24 岁青年， 青衫执卷， 眉目温润， 性格外圆内方， 谋定后动。
国风淡彩厚涂漫画， 笔触细腻， 光影柔和， 8K 高清， 展板。
03. 沈青禾｜侯府二小姐（女二）
正向 prompt：
漫剧角色人物设定展板， 竖版构图， 角色居中， 顶部标题栏， 底部信息条， 侧面坐姿。
16 岁少女， 鹅黄襦裙， 明媚娇憨， 心直口快。
国风淡彩厚涂漫画， 笔触细腻， 光影柔和， 8K 高清， 展板。

第二部分：皇室成员
04. 萧承稷｜当朝太子
正向 prompt：
漫剧角色人物设定展板， 竖版构图， 角色居中， 顶部标题栏， 底部信息条， 侧面坐姿。
26 岁储君， 玄金蟒袍， 姿仪威重， 城府极深。
国风淡彩厚涂漫画， 笔触细腻， 光影柔和， 8K 高清， 展板。
05. 慕容徽｜当朝太后
正向 prompt：
漫剧角色人物设定展板， 竖版构图， 角色居中， 顶部标题栏， 底部信息条， 侧面坐姿。
45 岁太后， 石青凤袍， 面容慈和， 手段狠戾。
国风淡彩厚涂漫画， 笔触细腻， 光影柔和， 8K 高清， 展板。
06. 顾长风｜禁军副统领
正向 prompt：
漫剧角色人物设定展板， 竖版构图， 角色居中， 顶部标题栏， 底部信息条， 侧面坐姿。
28 岁武官， 银甲配刀， 眉锋凌厉， 忠直寡言。国风淡彩厚涂漫画， 笔触细腻， 光影柔和， 8K 高清， 展板。`;

/** 无编号的普通大纲（应走旧 extractFromOutline 路径） */
const PLAIN = `一、故事背景：灵气复苏的大周王朝，宗门林立。
哥哥（林昭）：天赋觉醒古龙血脉，性格沉稳坚毅。`;

describe('parseCharacterSheet', () => {
  it('编号展板：条目数正确切分', () => {
    expect(parseCharacterSheet(SHEET)).toHaveLength(6);
  });

  it('名字与身份提取（含括号补充段）', () => {
    const entries = parseCharacterSheet(SHEET);
    expect(entries[0]?.name).toBe('沈青鸢');
    expect(entries[0]?.identity).toContain('镇北侯府嫡长女');
    expect(entries[0]?.identity).toContain('女主');
    expect(entries[1]?.name).toBe('陆云舟');
    expect(entries[1]?.identity).toContain('男主');
  });

  it('模板去重：description 不含头版式与尾画质词，仅留独有描述', () => {
    const entries = parseCharacterSheet(SHEET);
    for (const e of entries) {
      expect(e.description).not.toContain('漫剧角色人物设定展板');
      expect(e.description).not.toContain('8K 高清');
      expect(e.description).not.toContain('竖版构图');
    }
    expect(entries[0]?.description).toContain('玄色劲装束腰');
    expect(entries[5]?.description).toContain('银甲配刀');
    expect(entries[5]?.description).not.toContain('国风淡彩厚涂漫画');
  });

  it('分部标题：作为条目 group 标签', () => {
    const entries = parseCharacterSheet(SHEET);
    expect(entries[0]?.group).toBe('核心主角团');
    expect(entries[2]?.group).toBe('核心主角团');
    expect(entries[3]?.group).toBe('皇室成员');
    expect(entries[5]?.group).toBe('皇室成员');
  });

  it('年龄提取：描述中「N 岁」→ age 数值', () => {
    const entries = parseCharacterSheet(SHEET);
    expect(entries[0]?.age).toBe(18);
    expect(entries[1]?.age).toBe(24);
    expect(entries[4]?.age).toBe(45);
  });

  it('全局段：负面提示词与版式模板进 meta，不混入角色', () => {
    const doc = parseSheetDocument(SHEET);
    expect(doc.meta.negative).toContain('低分辨率');
    expect(doc.meta.template).toContain('漫剧角色人物设定展板');
    const joined = doc.entries.map((e) => e.description).join('');
    expect(joined).not.toContain('画面过曝');
  });

  it('名字缺失的编号行跳过，不产出条目', () => {
    const doc = parseSheetDocument(`01. 沈青鸢｜侯府嫡长女
18 岁少女， 玄色劲装。
02. ｜身份缺失者
30 岁路人。`);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]?.name).toBe('沈青鸢');
  });

  it('非编号文档：回退空数组，旧 extractFromOutline 路径仍可用', () => {
    expect(parseCharacterSheet(PLAIN)).toEqual([]);
    const legacy = extractFromOutline(PLAIN);
    expect(legacy.characters).toHaveLength(1);
    expect(legacy.characters[0]?.name).toBe('林昭');
    expect(legacy.background).toContain('大周王朝');
  });

  it('空值条目跳过（D9）：「反向 prompt：无」不拼入描述；描述整体为「无」的条目不入 entries', () => {
    const text = [
      '01. 沈青鸢｜镇国公府嫡长女',
      '正向 prompt：',
      '玄色劲装束腰，马尾高束。',
      '反向 prompt：无',
      '',
      '02. 空白甲｜无名之辈',
      '正向 prompt：无',
    ].join('\n');
    const doc = parseSheetDocument(text);
    expect(doc.entries).toHaveLength(1); // 「空白甲」（描述为「无」）整条跳过
    expect(doc.entries[0]!.name).toBe('沈青鸢');
    expect(doc.entries[0]!.description).toContain('玄色劲装束腰');
    expect(doc.entries[0]!.description).not.toContain('反向');
    expect(doc.entries[0]!.description).not.toContain('无');
  });
});

describe('buildSheetCardDraft / buildSheetWorldbookDraft', () => {
  it('角色卡：description 为去重后独有内容，不含模板词', () => {
    const doc = parseSheetDocument(SHEET);
    const card = buildSheetCardDraft(doc.entries[0] ?? { name: 'x', identity: '', group: '', description: '' });
    expect(card.spec).toBe('chara_card_v2');
    expect(card.data.name).toBe('沈青鸢');
    expect(card.data.description).toContain('玄色劲装束腰');
    expect(card.data.description).not.toContain('漫剧角色人物设定展板');
    expect(card.data.description).not.toContain('8K 高清');
  });

  it('世界书：每分部一个 constant 条目，负面与版式入备查条目', () => {
    const doc = parseSheetDocument(SHEET);
    const draft = buildSheetWorldbookDraft(doc);
    const entries = Object.values(draft.raw.entries);
    expect(entries.every((e) => e.constant === true)).toBe(true);
    expect(draft.name).toBe('人设展板世界书');
    const comments = entries.map((e) => e.comment).join('|');
    expect(comments).toContain('核心主角团');
    expect(comments).toContain('皇室成员');
    expect(comments).toContain('通用负面提示词');
    expect(comments).toContain('统一版式模板');
  });
});
