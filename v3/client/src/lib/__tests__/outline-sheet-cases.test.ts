/**
 * B 组：parseCharacterSheet 十例反复测试。每例独立 fixture（与既有
 * outline-sheet.test.ts 的 SHEET 缩样不重复），特征维度错开：分隔符、编号
 * 体系、分部/全局、模板有无、条目规模；暴露解析 bug 即修实现并回归。
 */
import { describe, expect, it } from 'vitest';

import { parseCharacterSheet, parseSheetDocument } from '../outline-sheet';

/** B1 标准格式：01. 名字｜身份 + prompt 段 + 自拟跨条目重复模板（无分部） */
const B1 = `【全局统一】负面提示词：变形， 多指， 模糊， 水印。
【全局统一】展板模板：古风立绘设定卡， 横向构图， 全身三视图， 纯色背景。

01. 楚千绝｜沧海阁少主（男主）
正向 prompt：
古风立绘设定卡， 横向构图， 全身三视图， 纯色背景。
21 岁青年， 一袭月白长衫， 剑眉入鬓， 气度清冷。
细节丰富， 4K分辨率， 大师级构图。
02. 苏挽月｜江南医女（女主）
正向 prompt：
古风立绘设定卡， 横向构图， 全身三视图， 纯色背景。
19 岁少女， 药香满袖， 眉目如画， 性格温柔坚韧。
细节丰富， 4K分辨率， 大师级构图。
03. 楚千帆｜沧海阁二公子（男二）
正向 prompt：
古风立绘设定卡， 横向构图， 全身三视图， 纯色背景。
20 岁青年， 锦衣华服， 笑面藏刀， 野心勃勃。
细节丰富， 4K分辨率， 大师级构图。`;

/** B2 半角分隔与英文名：1. Name|身份 */
const B2 = `1. Leon|天启小队队长
35 岁硬汉， 作战经验丰富， 沉默可靠。
2. Iris|随队医疗官
27 岁女性， 心思缜密， 枪法精准。`;

/** B3 中文编号条目头：一、名字｜身份 */
const B3 = `一、墨千秋｜听雨楼楼主
四十岁上下， 温文尔雅， 掌天下情报。
二、柳拂衣｜听雨楼首席
年方二八， 轻功卓绝， 心思剔透。`;

/** B4 无分部标题平铺 10 条（每条带同一头部模板行） */
const B4 = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1;
  return [
    `${String(n).padStart(2, '0')}. 夜行者${n}｜下城区佣兵${n}`,
    '赛博都市角色卡， 霓虹背景， 半身特写， 顶部代号栏。',
    `${18 + n} 岁佣兵， 机械义肢泛着冷光， 独来独往， 只认信用。`,
  ].join('\n');
}).join('\n');

/** B5 三个分部标题分组 */
const B5 = `第一部分：天命主角
1. 姜恒｜天命之子
一身反骨， 气运逆天。
第二部分：魔道枭雄
2. 血屠万里｜魔道巨擘
杀人如麻， 却重然诺。
第三部分：方外之人
3. 枯荣大师｜佛门高僧
慈悲为怀， 禅心通明。`;

/** B6 全局段：负面词 + 版式模板（条目描述不得混入） */
const B6 = `【全局统一】通用负面提示词：低质量， 手部畸形， 脸部崩坏。
【全局统一】统一版式：上下分栏， 左图右文， 标题加粗。
1. 商无咎｜北疆枭雄
北地风霜刻满脸庞， 目光如鹰。
2. 花想容｜南朝歌姬
一曲倾城， 心思难测。`;

/** B7 无重复模板：每条描述独居，去重算法不应动原文 */
const B7 = `1. 温衡｜药师谷传人
白鹿为伴， 药圃为家， 悬壶济世。
2. 岳千山｜独行刀客
刀出无声， 收刀有痕， 独来独往。
3. 云岫｜隐世琴师
一曲高山流水， 世人只闻其声不见其人。
4. 铁无衣｜戍边老兵
一杆断枪守孤城， 十年未解甲。`;

/** B8 单条目文档：去重统计跳过路径，description 原样 */
const B8 = `1. 谢无涯｜剑冢守墓人
守剑三十年， 未曾出鞘。`;

/** B9 描述为「无」/空白的条目应整条跳过 */
const B9 = `01. 甲｜铁壁武士
挥刀如风， 勇冠三军。
02. 乙｜落魄术士
无
03. 丙｜盲眼乐师
04. 丁｜伴月舞姬
暂无`;

/** B10 构造超长展板：count 条 × 每条约 500 字（模板头尾 + 独有段） */
function buildLongSheet(count: number, segsPerEntry: number): string {
  const rows: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    rows.push(`${String(i).padStart(2, '0')}. 玄门弟子${i}｜青冥峰${i}号院`);
    rows.push('水墨仙侠角色展板， 宣纸底纹， 全身立绘， 顶部名条， 底部门派印。');
    for (let k = 0; k < segsPerEntry; k += 1) {
      rows.push(`独有设定${i}-${k}：常年隐修于后山崖洞，掌心旧茧层层叠叠，一柄断剑从不离身，谈吐间偶露锋芒。`);
    }
    rows.push('工笔重彩， 墨色分明， 8K超清输出， 印章清晰。');
  }
  return rows.join('\n');
}
const B10 = buildLongSheet(30, 10);

describe('B 组：parseCharacterSheet 十例', () => {
  it('B1 标准格式：3 条切分 + 自拟模板去重 + 年龄提取 + 无分部空组', () => {
    const entries = parseCharacterSheet(B1);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.name)).toEqual(['楚千绝', '苏挽月', '楚千帆']);
    expect(entries[0]?.identity).toContain('沧海阁少主');
    expect(entries[1]?.identity).toContain('江南医女');
    for (const e of entries) {
      expect(e.description).not.toContain('古风立绘设定卡');
      expect(e.description).not.toContain('4K分辨率');
      expect(e.group).toBe('');
    }
    expect(entries[0]?.description).toContain('月白长衫');
    expect(entries[0]?.age).toBe(21);
    expect(entries[1]?.age).toBe(19);
    expect(entries[2]?.age).toBe(20);
  });

  it('B2 半角分隔：英文名 + 半角竖线正常提取', () => {
    const entries = parseCharacterSheet(B2);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.name).toBe('Leon');
    expect(entries[0]?.identity).toBe('天启小队队长');
    expect(entries[0]?.age).toBe(35);
    expect(entries[1]?.name).toBe('Iris');
    expect(entries[1]?.age).toBe(27);
  });

  it('B3 中文编号：一、二、条目头可识别，中文数字年龄不误取', () => {
    const entries = parseCharacterSheet(B3);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.name).toBe('墨千秋');
    expect(entries[0]?.identity).toBe('听雨楼楼主');
    expect(entries[1]?.name).toBe('柳拂衣');
    expect(entries[1]?.identity).toBe('听雨楼首席');
    expect(entries[0]?.age).toBeUndefined();
    expect(entries[0]?.description).toContain('温文尔雅');
  });

  it('B4 平铺 10 条：全数切分、无分组、模板行剥净', () => {
    const entries = parseCharacterSheet(B4);
    expect(entries).toHaveLength(10);
    expect(entries.every((e) => e.group === '')).toBe(true);
    for (const e of entries) {
      expect(e.description).not.toContain('赛博都市角色卡');
      expect(e.description).not.toContain('霓虹背景');
    }
    expect(entries[0]?.name).toBe('夜行者1');
    expect(entries[0]?.age).toBe(19);
    expect(entries[0]?.description).toContain('机械义肢');
    expect(entries[9]?.name).toBe('夜行者10');
  });

  it('B5 三个分部标题：group 归组正确', () => {
    const entries = parseCharacterSheet(B5);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.group).toBe('天命主角');
    expect(entries[1]?.group).toBe('魔道枭雄');
    expect(entries[2]?.group).toBe('方外之人');
    expect(entries.map((e) => e.name)).toEqual(['姜恒', '血屠万里', '枯荣大师']);
  });

  it('B6 全局段：负面与版式进 meta，不混入角色描述', () => {
    const doc = parseSheetDocument(B6);
    expect(doc.meta.negative).toContain('手部畸形');
    expect(doc.meta.template).toContain('上下分栏');
    expect(doc.entries).toHaveLength(2);
    const joined = doc.entries.map((e) => e.description).join('');
    expect(joined).not.toContain('标题加粗');
    expect(joined).not.toContain('脸部崩坏');
    expect(doc.entries[0]?.description).toContain('目光如鹰');
  });

  it('B7 无重复模板：description 原样保留不被剥行', () => {
    const entries = parseCharacterSheet(B7);
    expect(entries).toHaveLength(4);
    expect(entries[0]?.description).toBe('白鹿为伴， 药圃为家， 悬壶济世。');
    expect(entries[1]?.description).toBe('刀出无声， 收刀有痕， 独来独往。');
    expect(entries[2]?.description).toBe('一曲高山流水， 世人只闻其声不见其人。');
    expect(entries[3]?.description).toBe('一杆断枪守孤城， 十年未解甲。');
  });

  it('B8 单条目：去重统计跳过，description 完整原样', () => {
    const entries = parseCharacterSheet(B8);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('谢无涯');
    expect(entries[0]?.identity).toBe('剑冢守墓人');
    expect(entries[0]?.description).toBe('守剑三十年， 未曾出鞘。');
  });

  it('B9 无/空描述条目：乙丙丁整条跳过，仅甲入库', () => {
    const entries = parseCharacterSheet(B9);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('甲');
    expect(entries[0]?.description).toContain('挥刀如风');
  });

  it('B10 超长 30 条 × 每条约 500 字：去重正确且耗时 <1s', () => {
    const t0 = performance.now();
    const entries = parseCharacterSheet(B10);
    const ms = performance.now() - t0;
    expect(entries).toHaveLength(30);
    expect(entries[0]?.name).toBe('玄门弟子1');
    expect(entries[29]?.name).toBe('玄门弟子30');
    for (const e of entries) {
      expect(e.description).not.toContain('水墨仙侠角色展板');
      expect(e.description).not.toContain('8K超清输出');
      expect(e.description).toContain('独有设定');
    }
    expect(entries[0]?.description).toContain('独有设定1-9');
    expect(ms).toBeLessThan(1000);
  });
});
