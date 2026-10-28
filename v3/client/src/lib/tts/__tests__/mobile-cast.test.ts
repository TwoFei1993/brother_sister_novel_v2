/**
 * mobile-cast 单测：移动端音色目录 / 自动分声 / 段落说话人路由（跨段延续）
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_VOICES,
  NARRATOR_CAST_ID,
  engineOf,
  routeMobileParas,
  scanSpeakers,
  synthVoiceOf,
} from '../mobile-cast';
import { NARRATOR_VOICE_KEY, VOICES, autoCastVoices, routeParagraphs } from '../voice-route';

describe('ALL_VOICES 目录', () => {
  it('Edge 免费声 + MiniMax 全量声可选，id 引擎可判定', () => {
    expect(ALL_VOICES.filter((v) => v.engine === 'easyvoice').map((v) => v.id)).toEqual(VOICES.map((v) => v.voice));
    expect(ALL_VOICES.filter((v) => v.engine === 'minimax')).toHaveLength(60);
    expect(engineOf('xiaoxiao')).toBe('easyvoice');
    expect(engineOf('mm:female-shaonv')).toBe('minimax');
    expect(synthVoiceOf('mm:female-shaonv')).toBe('female-shaonv');
    expect(synthVoiceOf('xiaoxiao')).toBe('xiaoxiao');
  });

  it('分组元数据：粤语/旁白/角色各有归属，主持人女在旁白组', () => {
    expect(ALL_VOICES.filter((v) => v.group === 'cantonese')).toHaveLength(6);
    expect(ALL_VOICES.find((v) => v.id === 'mm:presenter_female')?.group).toBe('narrator');
    expect(ALL_VOICES.find((v) => v.id === 'mm:male-qn-badao')?.group).toBe('cast');
  });

  it('旁白默认音色必须是目录内真实存在的 id（防连字符/下划线漂移）', () => {
    expect(ALL_VOICES.some((v) => v.id === NARRATOR_CAST_ID)).toBe(true);
  });
});

describe('autoCastVoices（配音面板自动分配的底层）', () => {
  it('按名字性别线索分 MiniMax 池，同池轮替不重声；id 带 mm: 前缀', () => {
    const cast = autoCastVoices(['陈大哥', '林小妹', '王爷爷', '张阿姨']);
    expect(cast[0]?.voice).toMatch(/^mm:male-/);
    expect(cast[1]?.voice).toMatch(/^mm:female-/);
    expect(cast[2]?.voice).not.toBe(cast[0]?.voice); // 同男池不重声
    expect(cast[3]?.voice).not.toBe(cast[1]?.voice); // 同女池不重声
  });
});

describe('routeMobileParas 段落说话人路由', () => {
  it('空表：旁白走默认主持人女，名字前缀段命中 voiceMap', () => {
    const out = routeMobileParas(['夜色渐深。', '哥哥：走吧。'], { 哥哥: 'mm:male-qn-qingse' });
    expect(out[0]).toMatchObject({ speaker: 'narrator', voice: NARRATOR_CAST_ID });
    expect(out[1]).toMatchObject({ speaker: '哥哥', voice: 'mm:male-qn-qingse' });
  });

  it('无前缀引号对白跨段延续上一说话人（voiceMap 未配时回退旁白声）', () => {
    const out = routeMobileParas(['哥哥：「走吧。」', '「去哪儿？」', '风停了。'], {});
    expect(out[1]).toMatchObject({ speaker: '哥哥', voice: NARRATOR_CAST_ID });
    expect(out[2]).toMatchObject({ speaker: 'narrator', voice: NARRATOR_CAST_ID });
  });

  it('旁白声取 voiceMap 的 narrator 键', () => {
    const out = routeMobileParas(['夜色渐深。'], { [NARRATOR_VOICE_KEY]: 'xiaoxiao' });
    expect(out[0]?.voice).toBe('xiaoxiao');
  });

  it('旧连字符主持人 id 自愈为真实 id（路由层）', () => {
    const out = routeMobileParas(['夜色渐深。'], { [NARRATOR_VOICE_KEY]: 'mm:presenter-female' });
    expect(out[0]?.voice).toBe(NARRATOR_CAST_ID);
  });

  it('scanSpeakers：叙述尾巴归一 + 代词/场景词过滤', () => {
    const found = scanSpeakers(
      ['崔氏笑道：好。', '崔氏笑道：再来。', '孙妈妈：姑娘该歇了。', '她把仓房里的东西在心里过了一遍：没剩多少。', '贴身长随陆安低声劝道：走吧。'],
      new Set(),
    );
    const names = found.map((d) => d.name);
    expect(names).toContain('崔氏');
    expect(names).toContain('孙妈妈');
    expect(names).not.toContain('崔氏笑道');
    expect(names).not.toContain('她把仓房里的东西在心里过了一遍');
    expect(found.find((d) => d.name === '崔氏')?.count).toBe(2);
  });

  it('routeParagraphs：带叙述尾巴的名字裁尾命中 voiceMap（崔氏笑道→崔氏）', () => {
    const out = routeParagraphs('崔氏笑道：好孩子。\n崔氏：来。', { 崔氏: 'mm:female-yujie' }, [], 'narrator');
    expect(out[0]).toMatchObject({ speaker: '崔氏笑道', voice: 'mm:female-yujie' });
    expect(out[1]).toMatchObject({ speaker: '崔氏', voice: 'mm:female-yujie' });
  });
});
