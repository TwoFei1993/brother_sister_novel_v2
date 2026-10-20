/**
 * A 组：extractFromOutline 十例反复测试。每例独立 fixture（与既有
 * outline-wizard.test.ts 样本不重复），断言人物名/数量、背景、势力、矛盾的
 * 明确期望；暴露误抽/漏抽即修实现并以本文件回归。
 */
import { describe, expect, it } from 'vitest';

import { extractFromOutline } from '../../outline/wizard';

/** A1 标准【】分段 */
const A1 = `【背景】大炎王朝末年，魔气侵染九州大地，人族在绝境中艰难求存。
【主要人物】
林战：兄长，性格沉稳如山，一身横练武功出神入化。
林霜：妹妹，古灵精怪，天生冰灵之体。
【势力】玄天宗、万魔窟、丹霞谷三方对峙。
【核心矛盾】魔气源头直指玄天宗镇宗秘宝失踪真相。`;

/** A2 散文式无标记：人物名内嵌无冒号 */
const A2 = `北境雪原之上，兄长萧北冥性格冷峻寡言，一杆银枪镇守边关十载。
妹妹萧语嫣心思七窍玲珑，一手医术冠绝京华。
兄妹二人自幼相依为命，情比金坚。`;

/** A3 五条人物行（超出常规兄妹二元） */
const A3 = `背景：东海之滨的沧澜城，海妖频繁作乱。
哥哥：顾长歌，豪爽仗义，枪法如龙。
妹妹：顾小满，天真烂漫，驭水天赋异禀。
师父：玄机子，仙风道骨，深藏不露。
反派：海皇波旬，残暴嗜杀，觊觎人间气运。
挚友：白玉京，风流倜傥，重诺轻生。`;

/** A4 极简四行：一句话背景 + 一对兄妹 + 一个反派 */
const A4 = `背景：末法时代，灵气自地脉喷薄而出。
哥哥：秦岳，天生神力，寡言少语。
妹妹：秦月，机敏狡黠，擅破机关。
反派：黑蝎门主，阴狠毒辣，屠村夺宝。`;

/** A5 括号名人物 + 章节细纲段（与 A4 无括号兜底形态对照） */
const A5 = `背景：九州大地灵潮再起，宗门重开山门。
人物：
哥哥（洛尘）：剑道天才，冷面热心。
妹妹（洛璃）：丹术奇才，娇憨爱闹。

第一章：兄妹初入青云宗，洛尘力挫外门弟子。
第二章：秘境夺宝，洛璃误吞九转灵丹。
第三章：宗门大比，兄妹联手战天骄。`;

/** A6 markdown 干扰：井号标题 + 加粗 + 无其他装饰 */
const A6 = `## 世界观设定
灵潮复苏的蓝星，异兽横行，人族凭异能守城而居。

## 主要人物
**哥哥**：陆沉，雷系异能者，暴躁直率。
**妹妹**：陆瑶，空间系异能者，心思七窍。

## 势力分布
猎兽人协会、深渊教团、佣兵公会。

## 核心矛盾
深渊教团渗透协会高层，图谋覆灭人族。`;

/** A7 中英混排：英文名 + 括号中文身份 */
const A7 = `故事背景：末日废土，变异潮汐席卷全球，幸存者聚于地下城。
主要人物
Lin（哥哥）：铁血战士，冷静果决，擅长近身格斗。
Xia（妹妹）：机械天才，活泼好动，痴迷改装机甲。`;

/** A8 长文档（2000+ 字）：冗长背景在前、人物埋中段 */
const A8_BG =
  '这片大陆曾历经三次灵潮浩劫，王朝更迭江山几度易主，多少宗门崛起又覆灭于岁月长河，古老的盟约化作废纸，唯有强者的话音尚存余温。'.repeat(26);
const A8_TAIL =
  '风起于青萍之末，浪成于微澜之间，命运的齿轮自那一刻起悄然转动，无人可以置身事外。'.repeat(8);
const A8 = [
  '《靖难遗录》',
  `背景：${A8_BG}`,
  '主要人物',
  '燕回时：锦衣卫指挥使，冷面热心，刀法通神。',
  '燕栖梧：其妹，医毒双绝，外柔内刚。',
  '势力格局：北镇抚司、东林书院、漠北王庭三方角力。',
  '核心矛盾：靖难遗孤的身世之谜牵出锦衣卫内部的叛徒。',
  A8_TAIL,
].join('\n');

/** A9 缺失字段：只有背景与势力，无任何人物行 */
const A9 = `背景：上古洪荒，巫妖大战后天地破碎，不周山倾。
势力：巫族、妖族分治洪荒，人族夹缝求生。`;

/** A10 空串与乱码 */
const A10_NOISE = '¥……&*（）%￥#@！\n\n锕铋铌鲾橆\n===\n\t\t@@@\n';

describe('A 组：extractFromOutline 十例', () => {
  it('A1 标准【】分段：背景/人物/势力/矛盾全命中，矛盾不带右括号前缀', () => {
    const out = extractFromOutline(A1);
    expect(out.background).toContain('大炎王朝');
    expect(out.characters).toHaveLength(2);
    expect(out.characters.map((c) => c.name)).toContain('林战');
    expect(out.characters.map((c) => c.name)).toContain('林霜');
    expect(out.characters.find((c) => c.name === '林战')?.traits.join('')).toContain('沉稳如山');
    expect(out.factions.join('')).toContain('玄天宗');
    expect(out.conflict).toContain('魔气源头');
    expect(out.conflict.startsWith('】')).toBe(false);
  });

  it('A2 散文式无标记：内嵌「身份+人名+性格关键词」可抽出人名', () => {
    const out = extractFromOutline(A2);
    expect(out.characters).toHaveLength(2);
    const brother = out.characters.find((c) => c.name === '萧北冥');
    const sister = out.characters.find((c) => c.name === '萧语嫣');
    expect(brother?.role).toBe('兄长');
    expect(brother?.traits.join('')).toContain('冷峻寡言');
    expect(sister?.role).toBe('妹妹');
    expect(out.background).toBe('');
  });

  it('A3 五条人物行：全数抽出且特质各归其主', () => {
    const out = extractFromOutline(A3);
    expect(out.characters).toHaveLength(5);
    const names = out.characters.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['哥哥', '妹妹', '师父', '反派', '挚友']));
    expect(out.characters.find((c) => c.name === '哥哥')?.traits.join('')).toContain('豪爽仗义');
    expect(out.characters.find((c) => c.name === '反派')?.traits.join('')).toContain('残暴嗜杀');
    expect(out.background).toContain('沧澜城');
  });

  it('A4 极简四行：兄妹反派三兜底名 + 背景命中 + 矛盾势力为空', () => {
    const out = extractFromOutline(A4);
    expect(out.characters).toHaveLength(3);
    expect(out.characters.map((c) => c.name)).toEqual(['哥哥', '妹妹', '反派']);
    expect(out.characters.find((c) => c.name === '哥哥')?.traits.join('')).toContain('天生神力');
    expect(out.background).toContain('末法时代');
    expect(out.factions).toEqual([]);
    expect(out.conflict).toBe('');
  });

  it('A5 章节细纲：细纲行不入人物，不误判为矛盾', () => {
    const out = extractFromOutline(A5);
    expect(out.characters).toHaveLength(2);
    expect(out.characters.map((c) => c.name)).toContain('洛尘');
    expect(out.characters.map((c) => c.name)).toContain('洛璃');
    expect(out.background).toContain('灵潮再起');
    expect(out.conflict).toBe('');
    expect(out.characters.map((c) => c.name).join('')).not.toContain('第一章');
  });

  it('A6 markdown 干扰：剥装饰后背景/人物/势力/矛盾全命中', () => {
    const out = extractFromOutline(A6);
    expect(out.background).toContain('异兽横行');
    expect(out.characters).toHaveLength(2);
    expect(out.characters.map((c) => c.name).join('')).not.toContain('*');
    expect(out.characters.find((c) => c.name === '哥哥')?.traits.join('')).toContain('雷系异能者');
    expect(out.characters.find((c) => c.name === '妹妹')?.traits.join('')).toContain('空间系异能者');
    expect(out.factions.join('')).toContain('猎兽人协会');
    expect(out.conflict).toContain('深渊教团');
  });

  it('A7 中英混排：英文名 + 括号中文身份正常抽取', () => {
    const out = extractFromOutline(A7);
    expect(out.characters).toHaveLength(2);
    const brother = out.characters.find((c) => c.name === 'Lin');
    const sister = out.characters.find((c) => c.name === 'Xia');
    expect(brother?.role).toBe('哥哥');
    expect(brother?.traits.join('')).toContain('冷静果决');
    expect(sister?.role).toBe('妹妹');
    expect(sister?.traits.join('')).toContain('活泼好动');
    expect(out.background).toContain('废土');
  });

  it('A8 长文档 2000+ 字：背景截断不爆、中段人物照常抽出', () => {
    expect(A8.length).toBeGreaterThanOrEqual(2000);
    const out = extractFromOutline(A8);
    expect(out.background.length).toBeGreaterThan(0);
    expect(out.background.length).toBeLessThanOrEqual(520);
    expect(out.characters).toHaveLength(2);
    expect(out.characters.map((c) => c.name)).toContain('燕回时');
    expect(out.characters.map((c) => c.name)).toContain('燕栖梧');
    expect(out.factions.join('')).toContain('北镇抚司');
    expect(out.conflict).toContain('靖难遗孤');
  });

  it('A9 缺失字段：无人设时人物为空、背景势力照常、不崩', () => {
    const out = extractFromOutline(A9);
    expect(out.characters).toEqual([]);
    expect(out.background).toContain('洪荒');
    expect(out.factions.join('')).toContain('巫族');
    expect(out.conflict).toBe('');
  });

  it('A10 空串与乱码：全空结构不抛错', () => {
    for (const input of ['', '   \n  ', A10_NOISE]) {
      const out = extractFromOutline(input);
      expect(out.characters).toEqual([]);
      expect(out.background).toBe('');
      expect(out.abilities).toEqual([]);
      expect(out.factions).toEqual([]);
      expect(out.conflict).toBe('');
    }
  });
});
