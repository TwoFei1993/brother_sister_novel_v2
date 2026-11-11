/**
 * 说话人归属盲区回归（反馈四连：不换人/同角色不同声）：
 * 真实数据（《可爱的小猫》153 段实测）暴露的三个盲区——
 * ①段中冒号引号（名字埋段中、对白在后半段）→ 现状落旁白（15/153 段中招）
 * ②动词变体（「答得干脆」等不在动词表）→ 撞 carried 运气或落旁白
 * ③代词段尾（「她宣布」）+ 段首引号 → 已由延续覆盖（回归保护用例）
 */
import { describe, expect, it } from 'vitest';

import { routeParagraphs } from '../voice-route';

const VM = {
  narrator: 'mm:narrator',
  星璃: 'mm:xingli',
  宋遥: 'mm:songyao',
  星晏: 'mm:xingyan',
};

function route(paras: string[]) {
  // 整章一次路由（对齐真实链路 routeMobileParas：splitParagraphs 切行 + lastSpeaker 跨段延续）
  return routeParagraphs(paras.join('\n'), VM, [], VM.narrator);
}

describe('说话人归属盲区（反馈：不换人/同角色不同声）', () => {
  it('盲区①：段中「叙述，名字：“对白”」归属冒号前最近配音角色', () => {
    const [r] = route(['星璃收回爪子，轻轻拍了拍纸面：“那就是有人很早就替我安排了监护人。”']);
    expect(r!.voice).toBe('mm:xingli');
    expect(r!.speaker).toBe('星璃');
  });

  it('盲区①：冒号前有多个名字时取最靠近冒号的', () => {
    const [r] = route(['宋遥领着众人进门，星璃蹦到床边：“这张床为什么这么矮？”']);
    expect(r!.voice).toBe('mm:xingli');
  });

  it('盲区①：冒号前名字未配音（代词/陌生名）保持旁白不误配', () => {
    const [r] = route(['她转过身压低声音：“走吧，别让他等急了。”']);
    expect(r!.voice).toBe('mm:narrator'); // 声音必落旁白（speaker 标注允许为原文本，不影响听感）
  });

  it('盲区①：冒号后无引号（普通叙述冒号）不触发归属', () => {
    const [r] = route(['名单如下：张三、李四、王五。这是星璃整理的结果。']);
    expect(r!.voice).toBe('mm:narrator'); // 星璃不得被误配
  });

  it('盲区②：段尾动词变体「答得干脆」命中配音角色', () => {
    const [r] = route(['“我不知道。”星晏答得干脆，“我申请调取宗印使用记录。”']);
    expect(r!.voice).toBe('mm:xingyan');
  });

  it('盲区②：段尾动词变体「应道」「接道」「回道」同样命中', () => {
    for (const tail of ['应道', '接道', '回道']) {
      const [r] = route([`“好的。”宋遥${tail}，转身去准备。`]);
      expect(r!.voice, tail).toBe('mm:songyao');
    }
  });

  it('盲区③（回归保护）：段首引号+代词段尾延续上一说话人', () => {
    const rs = route(['“清单在这儿。”宋遥说，把本子递过去。', '“床可以。”她宣布，“现在看睡眠舱。”']);
    expect(rs[0]!.voice).toBe('mm:songyao');
    expect(rs[1]!.voice).toBe('mm:songyao'); // 代词段尾延续上一说话人
  });

  it('显式「名字：」前缀与段尾动词不受影响（既有行为）', () => {
    const rs = route(['星璃：走吧。', '“来了来了。”星璃笑道。']);
    expect(rs[0]!.voice).toBe('mm:xingli');
    expect(rs[1]!.voice).toBe('mm:xingli');
  });
});
