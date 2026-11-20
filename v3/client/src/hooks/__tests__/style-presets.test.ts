/**
 * mergeStylePresets 按风格挂预设（用户需求：通用常驻 + 风格按需，确认后写入 stylePresetIds）：
 * - 附加预设 prompts 追加主栈尾部、identifier 唯一化（sty<id6>- 前缀）
 * - enabled 跟随附加预设自身 prompt_order；空 content / marker 跳过
 * - 拉取失败静默跳过；stylePresetIds 为空原样返回（主预设不受影响）
 */
import { describe, expect, it, vi } from 'vitest';

const presetStore = new Map<string, unknown>();
vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(async (url: string) => {
    const id = String(url).split('/').pop() ?? '';
    if (!presetStore.has(id)) throw new Error('404');
    return presetStore.get(id);
  }),
}));

import { mergeStylePresets } from '../generation-pipeline';
import type { LlmPrefs } from '../../stores/settings';
import { defaultNovelSettings, type Work } from '@shared/work';
import type { PresetAsset } from '@shared/preset';
import type { TavernPreset } from '@shared/tavern';

const PREFS: LlmPrefs = { source: 'claude', model: 'MiniMax-M3', maxContext: 100000, maxTokens: 8192, temperature: 0.8 };

function workFixture(stylePresetIds: string[]): Work {
  return {
    id: 'w1', revision: 0, title: '风格挂载测试', mode: 'novel', genre: 'chuanyue',
    characterIds: [], worldbookIds: [], presetId: '', regexScriptIds: [], voiceMap: {},
    settings: { ...defaultNovelSettings, stylePresetIds },
    createdAt: 0, updatedAt: 0,
  };
}

function presetFixture(id: string, name: string, tags?: string[]): PresetAsset {
  return { id, name, createdAt: 0, tags, raw: { prompts: [], prompt_order: [], temperature: 1 } as unknown as TavernPreset };
}

const base: TavernPreset = {
  prompts: [{ identifier: 'main', name: '主写作风', content: '经典网文基调', role: 'system' }],
  prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
  temperature: 1,
} as unknown as TavernPreset;

function extraAsset(id: string, entries: { identifier: string; enabled: boolean; content?: string }[]): PresetAsset {
  return {
    id, name: '附加', createdAt: 0, tags: ['治愈'],
    raw: {
      prompts: entries.map((e) => ({ identifier: e.identifier, name: e.identifier, content: e.content ?? `内容-${e.identifier}`, role: 'system' })),
      prompt_order: [{ character_id: 100001, order: entries.map((e) => ({ identifier: e.identifier, enabled: e.enabled })) }],
      temperature: 1,
    } as unknown as TavernPreset,
  };
}

const messagesOf = (p: TavernPreset): string[] =>
  p.prompt_order?.[0]?.order.map((o) => o.identifier) ?? [];

describe('mergeStylePresets', () => {
  it('stylePresetIds 为空：原样返回 base（附加链路零开销）', async () => {
    const out = await mergeStylePresets(workFixture([]), base, PREFS);
    expect(out).toBe(base);
  });

  it('附加预设 prompts 追加主栈尾部 + identifier 唯一化 + enabled 继承', async () => {
    presetStore.set('extra1', extraAsset('extra1abcdef', [
      { identifier: 'healA', enabled: true },
      { identifier: 'healB', enabled: false },
    ]));
    const out = await mergeStylePresets(workFixture(['extra1']), base, PREFS);
    const ids = messagesOf(out);
    expect(ids).toEqual(['main', 'styextra1-healA', 'styextra1-healB']);
    const enabledOf = (i: string) => out.prompt_order?.[0]?.order.find((o) => o.identifier === i)?.enabled;
    expect(enabledOf('styextra1-healA')).toBe(true);
    expect(enabledOf('styextra1-healB')).toBe(false);
    // 主预设原条目不动
    expect(out.prompts.find((p) => p.identifier === 'main')?.content).toBe('经典网文基调');
    expect(out.prompts.find((p) => p.identifier === 'styextra1-healA')?.content).toBe('内容-healA');
  });

  it('空 content 与重复 id 跳过；拉取失败（404）静默不影响主预设', async () => {
    presetStore.set('extra2', extraAsset('extra2abcdef', [
      { identifier: 'blank', enabled: true, content: '   ' },
      { identifier: 'ok', enabled: true },
    ]));
    // 'ghost' 不在 store → apiFetch throw 404 → 静默跳过
    const out = await mergeStylePresets(workFixture(['extra2', 'ghost']), base, PREFS);
    const ids = messagesOf(out);
    expect(ids).toEqual(['main', 'styextra2-ok']);
  });
});
