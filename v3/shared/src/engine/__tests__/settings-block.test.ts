/**
 * buildSettingsBlock 同人创作块测试（用户需求 2026-11-22：软件理解「同人」——
 * 原著信息与同人纪律随设定块注入每次生成；原著详细设定走世界书/角色卡既有通道）
 */
import { describe, expect, it } from 'vitest';

import { buildSettingsBlock, FANDOM_NOTES_MAX_CHARS } from '../prompt/novel/settings-block';
import { defaultNovelSettings } from '../../work';

/** 同人书基座：题材 fanfic + 三字段（可覆盖） */
function fanficSettings(overrides: Partial<typeof defaultNovelSettings> = {}) {
  return {
    ...defaultNovelSettings,
    genre: 'fanfic' as const,
    fandomSource: '某武侠原著',
    fandomType: 'continue' as const,
    fandomNotes: '哥哥视角，时间线承接原作大结局之后',
    ...overrides,
  };
}

describe('buildSettingsBlock 同人创作块', () => {
  it('fanfic + 原著三字段：注入纪律块（原著/衍生类型/要点/禁止 OOC/原著优先）', () => {
    const block = buildSettingsBlock(fanficSettings());
    expect(block).toContain('【同人创作纪律');
    expect(block).toContain('原著：某武侠原著');
    expect(block).toContain('衍生类型：续写原作剧情');
    expect(block).toContain('同人要点：哥哥视角');
    expect(block).toContain('禁止 OOC');
    expect(block).toContain('以原著设定优先');
  });

  it('fanfic 无 fandom 字段：纪律块仍注入（同人语义不依赖字段），但无原著行', () => {
    const block = buildSettingsBlock(fanficSettings({ fandomSource: '', fandomType: undefined, fandomNotes: '' }));
    expect(block).toContain('【同人创作纪律');
    expect(block).toContain('禁止 OOC');
    expect(block).not.toContain('原著：');
  });

  it('非 fanfic 题材：即使 fandom 字段有值也不注入同人块（其他题材不受污染）', () => {
    const block = buildSettingsBlock(fanficSettings({ genre: 'hunhe' as const }));
    expect(block).not.toContain('【同人创作纪律');
    expect(block).not.toContain('禁止 OOC');
  });

  it('fandomNotes 超上限截断兜底（与 styleGuide 同款注入侧防线）', () => {
    const block = buildSettingsBlock(fanficSettings({ fandomNotes: '注'.repeat(FANDOM_NOTES_MAX_CHARS + 100) }));
    expect(block).toContain('注'.repeat(FANDOM_NOTES_MAX_CHARS));
    expect(block).not.toContain('注'.repeat(FANDOM_NOTES_MAX_CHARS + 1));
  });
});
