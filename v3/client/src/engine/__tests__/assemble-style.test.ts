/**
 * 文风复刻注入测试：settings.styleGuide 非空时进设定块（标记词锚定 + 位置在【作品设定】内）
 */
import { describe, expect, it } from 'vitest';

import { defaultNovelSettings } from '@shared/work';

import { assemblePrompt, buildSettingsBlock } from '../prompt/assemble';
import { EMPTY_SCAN, makeCtx } from './assemble-fixtures';

const MARKER = '【文风要求（最高优先级，逐条遵循）】';

describe('buildSettingsBlock 文风画像注入', () => {
  it('styleGuide 非空：设定块追加标记词与画像全文', () => {
    const block = buildSettingsBlock({ ...defaultNovelSettings, styleGuide: '短句为主，少用形容词。' });
    expect(block).toContain(MARKER);
    expect(block).toContain('短句为主，少用形容词。');
    // 标记词在【作品设定】块内部
    expect(block.startsWith('【作品设定】')).toBe(true);
    expect(block.indexOf(MARKER)).toBeGreaterThan(0);
  });

  it('styleGuide 缺省或纯空白：不注入标记词，回默认文风', () => {
    expect(buildSettingsBlock({ ...defaultNovelSettings })).not.toContain(MARKER);
    expect(buildSettingsBlock({ ...defaultNovelSettings, styleGuide: '  \n ' })).not.toContain(MARKER);
  });

  it('注入侧兜底：超 STYLE_GUIDE_MAX_CHARS 截断（历史超长数据不挤爆上下文预算）', async () => {
    const { STYLE_GUIDE_MAX_CHARS } = await import('../prompt/settings-block');
    const long = '长'.repeat(STYLE_GUIDE_MAX_CHARS + 100);
    const block = buildSettingsBlock({ ...defaultNovelSettings, styleGuide: long });
    expect(block).toContain(MARKER);
    expect(block).toContain('长'.repeat(STYLE_GUIDE_MAX_CHARS));
    expect(block).not.toContain('长'.repeat(STYLE_GUIDE_MAX_CHARS + 1)); // 超出部分被截断
  });

  it('assemblePrompt 全链路：画像随 scenario 设定块出现在历史之前', () => {
    const result = assemblePrompt(
      makeCtx({
        worldbookScan: EMPTY_SCAN,
        workSettings: { ...defaultNovelSettings, styleGuide: '短句急促，动作为主。' },
      }),
    );
    // scenario 块 = 卡 scenario + 设定块（【作品设定】概要），画像在设定块内
    const scenarioMsg = result.messages.find((m) => m.content.includes('【作品设定】'));
    expect(scenarioMsg).toBeDefined();
    expect(scenarioMsg?.content).toContain(MARKER);
    expect(scenarioMsg?.content).toContain('短句急促，动作为主。');
  });
});
