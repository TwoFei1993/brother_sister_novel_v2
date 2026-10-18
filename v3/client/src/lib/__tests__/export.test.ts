/**
 * 导出工具单测（Task 32）：文件名安全化 + 书名智能提取（纯函数部分；
 * exportTxt 的 Blob 下载行为由 E2E 覆盖）。
 */
import { describe, expect, it } from 'vitest';

import { sanitizeFilename, suggestBookTitles } from '../export';

describe('sanitizeFilename', () => {
  it('替换 Windows/Unix 非法字符', () => {
    expect(sanitizeFilename('我的书:卷一/第二章?')).toBe('我的书_卷一_第二章_');
  });

  it('空值兜底 export', () => {
    expect(sanitizeFilename('')).toBe('export');
    expect(sanitizeFilename('///')).toBe('___');
  });
});

describe('suggestBookTitles', () => {
  it('优先提取 AI 推荐书名段', () => {
    const outline = '## 故事梗概\n兄妹重生。\n\n## 推荐书名\n1. 《灵潮双璧》\n2. 《重生之兄妹同行》\n3. 《九州兄妹录》\n\n## 正文';
    expect(suggestBookTitles(outline)).toEqual(['灵潮双璧', '重生之兄妹同行', '九州兄妹录']);
  });

  it('无推荐段时按哥哥/妹妹名与世界名兜底生成', () => {
    const outline = '哥哥名叫林昭，妹妹名叫林婉儿，故事发生在世界【九州】的灵气复苏时代。';
    const titles = suggestBookTitles(outline);
    expect(titles).toHaveLength(3);
    expect(titles.join('|')).toContain('林昭');
    expect(titles.join('|')).toContain('林婉儿');
  });

  it('空大纲也有 3 个兜底候选', () => {
    const titles = suggestBookTitles('');
    expect(titles).toHaveLength(3);
    expect(titles.every((t) => t.length > 0)).toBe(true);
  });
});
