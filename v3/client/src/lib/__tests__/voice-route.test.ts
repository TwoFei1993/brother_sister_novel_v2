/**
 * TTS 段落说话人路由测试（设计 §7.3 / Task 29 Step 1）
 *
 * 覆盖：角色名前缀归属 / 引号段归属前文说话人 / 无归属旁白 /
 * voiceMap 缺失回退 / 引号跨行合并 / 空行过滤与顺序保持 /
 * speakers 补充与 voiceMap 覆盖语义 / 标题剥离与半角冒号
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_VOICE_ID, VOICES, routeParagraphs, voiceIdToName } from '../tts/voice-route';

describe('routeParagraphs 说话人路由', () => {
  it('角色名前缀段落归该角色声（voiceMap 命中）', () => {
    const out = routeParagraphs('哥哥：站住，别跑。', { 哥哥: 'yunjian' }, [], 'xiaoxiao');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ voice: 'yunjian', speaker: '哥哥' });
    // 前缀不截断，整段送 TTS
    expect(out[0].text).toBe('哥哥：站住，别跑。');
  });

  it('无前缀引号段归属前文最近说话人', () => {
    const text = '哥哥：站住，别跑。\n「凭什么，就不跑。」';
    const out = routeParagraphs(text, { 哥哥: 'yunjian' }, [], 'xiaoxiao');
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ voice: 'yunjian', speaker: '哥哥' });
  });

  it('无归属段落走旁白默认声', () => {
    const out = routeParagraphs('夜色渐深，虫鸣四起。', {}, [], 'yunyang');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ voice: 'yunyang', speaker: 'narrator' });
  });

  it('voiceMap 缺失的角色前缀回退旁白声（后续引号段跟随）', () => {
    const text = '路人甲：让开。\n「休想过去。」';
    const out = routeParagraphs(text, {}, [], 'xiaoxiao');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ voice: 'xiaoxiao', speaker: '路人甲' });
    expect(out[1]).toMatchObject({ voice: 'xiaoxiao', speaker: '路人甲' });
  });

  it('引号跨行合并为单段（「 未闭合时吸收后续行）', () => {
    const text = '「今天天气\n真不错，\n适合出门。」\n他背上书包走了。';
    const out = routeParagraphs(text, {}, [], 'xiaoxiao');
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe('「今天天气\n真不错，\n适合出门。」');
    expect(out[1].text).toBe('他背上书包走了。');
  });

  it('空行与纯空白行过滤，段落顺序保持', () => {
    const text = '第一段\n\n\n第二段\n   \n第三段';
    const out = routeParagraphs(text, {}, [], 'xiaoxiao');
    expect(out.map((p) => p.text)).toEqual(['第一段', '第二段', '第三段']);
  });

  it('speakers 作为补充来源，voiceMap 同名覆盖优先', () => {
    const out = routeParagraphs(
      '妹妹：哥哥你好坏。',
      { 妹妹: 'xiaobei' },
      [
        { name: '妹妹', voice: 'xiaoyi' },
        { name: '路人乙', voice: 'yunxi' },
      ],
      'xiaoxiao',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ voice: 'xiaobei', speaker: '妹妹' });
  });

  it('剥离 # 标题前缀；半角冒号前缀同样识别', () => {
    const text = '## 第三章 夜行\n哥哥:跟我来。\n「去哪？」';
    const out = routeParagraphs(text, { 哥哥: 'yunjian' }, [], 'xiaoxiao');
    expect(out).toHaveLength(3);
    expect(out[0].text).toBe('第三章 夜行');
    expect(out[0]).toMatchObject({ voice: 'xiaoxiao', speaker: 'narrator' });
    expect(out[1]).toMatchObject({ voice: 'yunjian', speaker: '哥哥' });
    expect(out[2]).toMatchObject({ voice: 'yunjian', speaker: '哥哥' });
  });
});

describe('段尾说话人标记（自然小说文风，音色不生效修复）', () => {
  it('「“对白。”小明说道。」→ 提取小明归角色声', () => {
    const out = routeParagraphs('“站住。”小明说道。', { 小明: 'yunjian' }, [], 'xiaoxiao');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ voice: 'yunjian', speaker: '小明' });
    expect(out[0].text).toBe('“站住。”小明说道。'); // 整段送 TTS 不截断
  });

  it('修饰词+地+动词变体（淡淡地说道/轻声问道）与段尾长尾巴均命中', () => {
    const vm = { 小明: 'yunjian', 妹妹: 'xiaobei' };
    const a = routeParagraphs('“别走。”小明淡淡地说道，随即转身离开。', vm, [], 'xiaoxiao');
    expect(a[0]).toMatchObject({ voice: 'yunjian', speaker: '小明' });
    const b = routeParagraphs('“你去哪？”妹妹轻声问道。', vm, [], 'xiaoxiao');
    expect(b[0]).toMatchObject({ voice: 'xiaobei', speaker: '妹妹' });
    const c = routeParagraphs('“嗯。”小明说着穿好鞋。', vm, [], 'xiaoxiao');
    expect(c[0]).toMatchObject({ voice: 'yunjian', speaker: '小明' });
  });

  it('代词/群体标记（她说/众人喊道）不命中 voiceMap → 保持旁白', () => {
    const out = routeParagraphs('“好。”她说道。', { 小明: 'yunjian' }, [], 'xiaoxiao');
    expect(out[0]).toMatchObject({ voice: 'xiaoxiao', speaker: 'narrator' });
  });

  it('纯叙述段不受段尾标记误伤（动词离段尾远/无引号）', () => {
    const out = routeParagraphs('他说话很温柔，让人如沐春风。', { 小明: 'yunjian' }, [], 'xiaoxiao');
    expect(out[0]).toMatchObject({ voice: 'xiaoxiao', speaker: 'narrator' });
  });

  it('段尾标记命中后更新 lastSpeaker：后续无标记引号段延续该角色', () => {
    const text = '“站住。”小明说道。\n“凭什么？”';
    const out = routeParagraphs(text, { 小明: 'yunjian' }, [], 'xiaoxiao');
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ voice: 'yunjian', speaker: '小明' });
  });

  it('直角引号「」同样识别段尾标记', () => {
    const out = routeParagraphs('「站住。」崔氏笑道。', { 崔氏: 'xiaobei' }, [], 'xiaoxiao');
    expect(out[0]).toMatchObject({ voice: 'xiaobei', speaker: '崔氏' });
  });

  it('动作/状态前缀段（真实数据主流形态）→ 最长前缀收缩命中角色声', () => {
    // 「苏棠的声音发颤：」——段首名字+动作+冒号，名字查表 miss，前缀收缩到「苏棠」
    const out = routeParagraphs('苏棠的声音发颤：“你们想要什么？”', { 苏棠: 'xiaobei' }, [], 'xiaoxiao');
    expect(out[0]).toMatchObject({ voice: 'xiaobei', speaker: '苏棠' });
    expect(out[0].text).toBe('苏棠的声音发颤：“你们想要什么？”');
  });

  it('speaker 收缩干净：裁尾命中的段首名（「老人说」）speaker 归「老人」', () => {
    // voiceMap 无「老人说」→ 后续引号延续段经 routeMobileParas vm[lastSpeaker] 直查才不 miss
    const out = routeParagraphs('老人说：“跟我来。”\n“去哪？”', { 老人: 'yunjian' }, [], 'xiaoxiao');
    expect(out[0]).toMatchObject({ voice: 'yunjian', speaker: '老人' });
    expect(out[1]).toMatchObject({ voice: 'yunjian', speaker: '老人' });
  });

  it('无角色命中的引导段（「纸上只写了一句话：」）落旁白且不误配', () => {
    const out = routeParagraphs('纸上只写了一句话：“出去。”', { 苏棠: 'xiaobei' }, [], 'xiaoxiao');
    expect(out[0]).toMatchObject({ voice: 'xiaoxiao', speaker: '纸上只写了一句话' });
  });
});

describe('VOICES 与工具', () => {
  it('Edge 免费声全量 18 声（9 女 9 男），含 easyvoice 底层名', () => {
    expect(VOICES).toHaveLength(18);
    expect(VOICES.filter((v) => v.gender === 'female')).toHaveLength(9);
    expect(VOICES.filter((v) => v.gender === 'male')).toHaveLength(9);
    expect(voiceIdToName('yunjian')).toBe('zh-CN-YunjianNeural');
    // 未知 id 回退默认声
    expect(voiceIdToName('nope')).toBe(voiceIdToName(DEFAULT_VOICE_ID));
  });
});
