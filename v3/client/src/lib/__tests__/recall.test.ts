import { describe, expect, it } from 'vitest';

import { bigrams, recallBlock, retrievePassages, splitWindows } from '../recall';

const CORPUS = [
  '三号冷却泵的液冷管在陨石雨中震裂，妹妹用点焊枪封了三道焊缝，冷却液还是漏了一半。',
  '云雀学院的开学典礼定在秋分，院长揭晓了这一届的分系名单，妹妹被分进了日冕系。',
  '神秘地图的边缘画着一座废墟，哥哥认出那是二十年前失踪的探险队最后出现的地方。',
].join('\n\n');

describe('splitWindows（段落聚合切窗）', () => {
  it('短段落聚合到接近 windowSize 但不截断段落', () => {
    const ws = splitWindows(CORPUS, 500);
    expect(ws.length).toBeGreaterThanOrEqual(1);
    expect(ws.join('\n\n').replace(/\s/g, '')).toBe(CORPUS.replace(/\s/g, ''));
  });
});

describe('retrievePassages（远距记忆检索）', () => {
  it('与指令强相关的窗口排前且命中阈值', () => {
    const hits = retrievePassages('陨石雨砸穿了飞船，冷却泵失效', CORPUS, 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.text).toContain('冷却泵');
  });

  it('完全无关的指令 → 空结果（宁缺毋滥）', () => {
    expect(retrievePassages('都市写字楼里的股票交易日常', CORPUS, 3)).toEqual([]);
  });
});

describe('recallBlock（注入块组装）', () => {
  it('有命中 → 带标题的注入块；无命中 → 空串', () => {
    const hit = recallBlock('陨石雨 冷却泵', CORPUS);
    expect(hit).toContain('前文相关回忆');
    expect(hit).toContain('冷却泵');
    expect(recallBlock('毫不相干的日常', CORPUS)).toBe('');
  });
});

describe('bigrams（二元组基础）', () => {
  it('去空白、含 v4 过滤虚词', () => {
    const g = bigrams('了  的一');
    expect(g.size).toBe(0);
    expect(bigrams('冷却泵').has('冷却')).toBe(true);
  });
});
