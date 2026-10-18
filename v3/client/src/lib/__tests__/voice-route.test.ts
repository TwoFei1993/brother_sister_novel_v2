/**
 * TTS 段落说话人路由测试（设计 §7.3 / Task 29 Step 1）
 *
 * 覆盖：角色名前缀归属 / 引号段归属前文说话人 / 无归属旁白 /
 * voiceMap 缺失回退 / 引号跨行合并 / 空行过滤与顺序保持 /
 * speakers 补充与 voiceMap 覆盖语义 / 标题剥离与半角冒号
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_VOICE_ID, VOICES, routeParagraphs, voiceIdToName } from '../voice-route';

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

describe('VOICES 与工具', () => {
  it('声音常量对齐旧站 6 声（3 女 3 男），含 easyvoice 底层名', () => {
    expect(VOICES).toHaveLength(6);
    expect(VOICES.filter((v) => v.gender === 'female')).toHaveLength(3);
    expect(VOICES.filter((v) => v.gender === 'male')).toHaveLength(3);
    expect(voiceIdToName('yunjian')).toBe('zh-CN-YunjianNeural');
    // 未知 id 回退默认声
    expect(voiceIdToName('nope')).toBe(voiceIdToName(DEFAULT_VOICE_ID));
  });
});
