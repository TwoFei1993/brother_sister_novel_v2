import { describe, expect, it } from 'vitest';

import { isChatterLine, stripChatPreamble } from '../prompt/novel/chat-preamble';
import { postprocessMessage, presentable, presentableNovel } from '../prompt/postprocess';

/** 用户实测泄露样本（MiniMax 系角色扮演模型，对 System 寒暄后才写正文） */
const REAL_SAMPLE = [
  '思考已结束。',
  '',
  '收到的呢，System！',
  '',
  '现在可以开始创作了嘛？',
  '',
  'System有什么需要我写的东西吗？只要你说出来，我都能帮你写的呢！ 坐在咖啡馆里，双手托腮，眼神温柔地看着屏幕，嘴角带着浅浅的笑意',
  '',
  '你想让我写什么类型的文章呢？散文、小说、还是其他什么？或者有没有特定的主题和情感呢？把要求告诉我吧，我很擅长捕捉细腻的情感呢～',
  '',
  '兄妹进入城堡',
  '',
  '我仰起头，嘴巴不自觉地张成了O型。',
  '',
  '哥哥在我身旁倒吸了一口凉气，我们就这样站在巨大的橡木门前，望着那座高耸入云的城堡塔尖。',
].join('\n');

describe('闲聊前导剥离 stripChatPreamble（novel 专用）', () => {
  it('用户实测样本整段剥出正文（思考标记/应答/反问/系统服务/指令回显全覆盖）', () => {
    const body = stripChatPreamble(REAL_SAMPLE, '兄妹进入城堡');
    expect(body).toContain('我仰起头，嘴巴不自觉地张成了O型');
    expect(body).toContain('哥哥在我身旁倒吸了一口凉气');
    expect(body).not.toContain('思考已结束');
    expect(body).not.toContain('System');
    expect(body).not.toContain('收到的呢');
    expect(body).not.toContain('兄妹进入城堡');
  });

  it('各类闲聊行逐类命中（isChatterLine）', () => {
    expect(isChatterLine('思考已结束。')).toBe(true);
    expect(isChatterLine('收到的呢，System！')).toBe(true);
    expect(isChatterLine('好的，明白。')).toBe(true);
    expect(isChatterLine('现在可以开始创作了嘛？')).toBe(true);
    expect(isChatterLine('System有什么需要我写的东西吗？只要你写，我都能写！看屏幕，浅浅笑意')).toBe(true);
    expect(isChatterLine('*微笑着看着你*')).toBe(true);
    expect(isChatterLine('（眼神温柔地看着屏幕）')).toBe(true);
    expect(isChatterLine('兄妹进入城堡', '兄妹进入城堡')).toBe(true);
    expect(isChatterLine('指令：兄妹进入城堡')).toBe(true);
  });

  it('叙述行/结构行不判为闲聊（防误杀）', () => {
    expect(isChatterLine('# 第1章 城堡之门')).toBe(false);
    expect(isChatterLine('我仰起头，嘴巴不自觉地张成了O型。')).toBe(false);
    expect(isChatterLine('「现在可以开始了吗？」妹妹小声问道。')).toBe(false); // 引号对白
    expect(isChatterLine('哥哥在我身旁倒吸了一口凉气，我们就这样站在巨大的橡木门前，望着那座高耸入云的城堡塔尖。')).toBe(false);
    expect(isChatterLine('系统面板忽然亮起，一行小字浮现出来。')).toBe(false); // 叙事里的系统
  });

  it('回归：无 # 的纯文本章节标题（含指令词）不判为指令回显（code review 误伤场景）', () => {
    expect(isChatterLine('第3章 兄妹进入城堡', '兄妹进入城堡')).toBe(false);
    const body = stripChatPreamble('第3章 兄妹进入城堡\n\n兄妹俩踏上石阶。'.repeat(2), '兄妹进入城堡');
    expect(body).toContain('第3章 兄妹进入城堡');
  });

  it('回归：指令织入首句叙述不是回显（裸指令才算，code review 误伤场景）', () => {
    expect(isChatterLine('兄妹进入城堡，寒气刺骨。', '兄妹进入城堡')).toBe(false);
    expect(isChatterLine('兄妹进入城堡的那天，天色阴沉。', '兄妹进入城堡')).toBe(false);
    // 裸指令回显形态仍然命中
    expect(isChatterLine('兄妹进入城堡', '兄妹进入城堡')).toBe(true);
    expect(isChatterLine('（兄妹进入城堡）', '兄妹进入城堡')).toBe(true);
    const body = stripChatPreamble(
      ['兄妹进入城堡，寒气刺骨。', '我攥紧了火把。', '哥哥在我身后轻轻推了推我。'].join('\n'),
      '兄妹进入城堡',
    );
    expect(body).toContain('寒气刺骨');
  });

  it('回归：正文开篇的叙述反问（泛化疑问词）不判为闲聊（code review 误伤场景）', () => {
    expect(isChatterLine('需要我陪你去吗？')).toBe(false);
    expect(isChatterLine('要我帮你拿着吗？哥哥接过书包。')).toBe(false);
  });

  it('回归：指令织进正文首句不剥离（深度测试「误伤正文首行」场景，指令=兄妹进入城堡）', () => {
    expect(isChatterLine('兄妹进入城堡后，夜色渐深。', '兄妹进入城堡')).toBe(false);
    const body = stripChatPreamble(
      ['兄妹进入城堡后，夜色渐深。', '火把的光在石壁上摇晃。', '妹妹紧紧攥住了哥哥的衣角。'].join('\n'),
      '兄妹进入城堡',
    );
    expect(body).toContain('夜色渐深'); // 正文首行原样保留
  });

  it('回显命中形态（收紧后语义）：去标点等于 / 引导词前缀且含指令原文', () => {
    // ① 去标点空白后等于指令（含括号/书名号包裹、尾标点变体）
    expect(isChatterLine('兄妹进入城堡！', '兄妹进入城堡')).toBe(true);
    expect(isChatterLine('《兄妹进入城堡》', '兄妹进入城堡')).toBe(true);
    // 引号开篇行由 isNarrativeLine 先行保护（视作正文，永不剥离）
    // ② 引导词前缀（含用户输入）且含指令原文
    expect(isChatterLine('剧情指引：兄妹进入城堡', '兄妹进入城堡')).toBe(true);
    expect(isChatterLine('用户输入：兄妹进入城堡', '兄妹进入城堡')).toBe(true);
    // 引导词行但不含指令原文 → 不是本指令的回显，不剥离
    expect(isChatterLine('剧情指引：写一段城堡夜戏', '兄妹进入城堡')).toBe(false);
    // 无可比指令时退回「指令：」标签形态判定
    expect(isChatterLine('指令：兄妹进入城堡')).toBe(true);
  });

  it('正文开头无闲聊时原样返回（零改动）', () => {
    const pure = '# 第1章 开端\n\n清晨的阳光洒进窗户。';
    expect(stripChatPreamble(pure)).toBe(pure);
  });

  it('剥后剩余过短则保守放弃（防清空）', () => {
    const short = '思考已结束。\n\n好。'; // 剥完只剩 2 字
    expect(stripChatPreamble(short)).toBe(short);
  });

  it('全是闲聊时整段保留（不输出空串）', () => {
    const all = '思考已结束。\n\n收到的呢，System！\n\n现在可以开始创作了嘛？';
    expect(stripChatPreamble(all)).toBe(all);
  });

  it('presentableNovel 组合链生效而 presentable 不受影响（chat 安全）', () => {
    expect(presentableNovel(REAL_SAMPLE, '兄妹进入城堡')).toContain('我仰起头');
    // chat 轨：星号动作是合法角色扮演内容，不被剥离
    expect(presentable('*坐在咖啡馆里，双手托腮*你终于来了呢。')).toContain('*坐在咖啡馆里');
  });

  it('postprocessMessage 的 stripChatter 开关仅 novel 入库轨生效', () => {
    const on = postprocessMessage(REAL_SAMPLE, { directive: '兄妹进入城堡', stripChatter: true });
    expect(on.content).toContain('我仰起头');
    expect(on.content).not.toContain('System');
    const off = postprocessMessage(REAL_SAMPLE, { directive: '兄妹进入城堡' });
    expect(off.content).toContain('System');
  });
});
