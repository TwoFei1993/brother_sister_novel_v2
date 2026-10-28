/**
 * mobile-cast 单测：移动端音色目录 / 自动分声 / 段落说话人路由（跨段延续）
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_VOICES,
  NARRATOR_CAST_ID,
  engineOf,
  routeMobileParas,
  synthVoiceOf,
} from '../mobile-cast';
import { NARRATOR_VOICE_KEY, VOICES, autoCastVoices } from '../voice-route';

describe('ALL_VOICES 目录', () => {
  it('Edge 免费声 + MiniMax 高清声全量可选，id 引擎可判定', () => {
    expect(ALL_VOICES.filter((v) => v.engine === 'easyvoice').map((v) => v.id)).toEqual(VOICES.map((v) => v.voice));
    expect(ALL_VOICES.filter((v) => v.engine === 'minimax')).toHaveLength(8);
    expect(engineOf('xiaoxiao')).toBe('easyvoice');
    expect(engineOf('mm:female-shaonv')).toBe('minimax');
    expect(synthVoiceOf('mm:female-shaonv')).toBe('female-shaonv');
    expect(synthVoiceOf('xiaoxiao')).toBe('xiaoxiao');
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
});
