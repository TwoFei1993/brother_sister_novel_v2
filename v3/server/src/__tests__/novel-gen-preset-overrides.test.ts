/**
 * 预设文风按书覆盖 + 变量传递（server 组装层端到端，不调 LLM）。
 * fixture 按 Sudachi-Next-Preset 真实机制构造：新文系文风全文内联、老文系文风经
 * {{setvar::style}} 存变量、由靠后的「📙文风」条目 {{getvar::style}} 注入；
 * 情感基调条目直接内联 <tone>（可多选并存）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultNovelSettings, type Work } from '@shared/work';
import type { Message } from '@shared/message';

import { loadAssembleAssets } from '../services/novel-gen/assets';
import { buildMacroEnv, scanAndAssemble } from '../services/novel-gen/assemble';
import { readJson, writeJsonAtomic } from '../storage/store';

let root = '';
const PID = 'preset-sudachi-like-0001';
const WID = 'work-preset-override-1';
const PREFS = { source: 'openai' as const, model: 'gpt-4o', maxContext: 65536, maxTokens: 8192 } as never;

type Row = [identifier: string, name: string, content: string, enabled?: boolean];
const ROWS: Row[] = [
  ['main', '🐳主提示', '你是小说作家。', true],
  ['h-style', '—\\📖文风设定===', '{{//单选}}', true],
  ['n-light', '🔖N-轻小说', '<writing_style>日系轻小说：以对话推动，语气词丰富</writing_style>{{setvar::style::具体参照<writing_style>内的文风要求}}', true],
  ['short-drama', '🔥短剧式', '{{setvar::style::文风: 热门短剧式——群体贬低→意外反转→震惊追悔的循环叙事}}', false],
  ['lu-xun', '🖋鲁迅式', '{{setvar::style::文风: 冷峻白描，反讽克制}}', false],
  // 「📙文风」在真实 Sudachi 里位于历史区（marker 之后），不属于文风分组——单选不会关掉它
  ['h-tone', '—\\🕰情感基调===', '<keynote>情感基调</keynote>', true],
  ['tone-general', '⚫通用', '<tone>基调: 自然平衡</tone>', true],
  ['tone-joy', '⚫欢快', '<tone>基调: 欢快明亮</tone>', false],
  ['chatHistory', 'Chat History', '', true],
  ['style-slot', '📙文风', '<style>核心文风，务必遵守\n{{getvar::style}}\n</style>', true],
  ['jailbreak', '收尾', '只输出正文。', true],
];

function makeWork(settings: Partial<typeof defaultNovelSettings> = {}): Work {
  return {
    id: WID, revision: 1, title: '预设文风测试书', mode: 'novel', genre: 'chuanyue',
    characterIds: [], worldbookIds: [], presetId: PID, regexScriptIds: [],
    settings: { ...defaultNovelSettings, storyTones: [], ...settings },
    voiceMap: {}, createdAt: 1, updatedAt: 1,
  } as Work;
}

/** 走真实组装链，返回拼好的全部提示词 */
async function assemble(work: Work, pending?: { work: Map<string, string>; global: Map<string, string> }): Promise<string> {
  const assets = await loadAssembleAssets(work);
  const p = pending ?? { work: new Map<string, string>(), global: new Map<string, string>() };
  const env = buildMacroEnv(work, undefined, p, {});
  const fitted = await scanAndAssemble(work, [] as Message[], { kind: 'directive', text: '写第一章' }, assets, env, PREFS);
  return fitted.messages.map((m) => m.content).join('\n');
}

const styleBlock = (all: string): string => all.slice(all.indexOf('<style>'), all.indexOf('</style>') + 8);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-preset-override-'));
  process.env.DATA_DIR = root;
  await writeJsonAtomic(join(root, 'presets', `${PID}.json`), {
    id: PID, name: 'Sudachi 类预设',
    raw: {
      prompts: ROWS.map(([identifier, name, content]) =>
        identifier === 'chatHistory'
          ? { identifier, marker: true }
          : { identifier, name, role: 'system', content, system_prompt: true },
      ),
      prompt_order: [{ character_id: 100001, order: ROWS.map(([identifier, , , enabled]) => ({ identifier, enabled: enabled ?? false })) }],
    },
  });
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('buildMacroEnv 变量传递（bug 修复：同次组装内 setvar 后 getvar 可读）', () => {
  it('本次 setvar 的值立即可读（work 级 / global 级）', async () => {
    const work = makeWork();
    const pending = { work: new Map<string, string>(), global: new Map<string, string>() };
    const env = buildMacroEnv(work, undefined, pending, {});
    env.setVar('style', '短剧式文风', 'work');
    env.setVar('g1', '全局值', 'global');
    expect(env.getVar('style', 'work')).toBe('短剧式文风');
    expect(env.getVar('g1', 'global')).toBe('全局值');
  });

  it('本次未 setvar 时回落到已持久化的值（作品级 / 全局级）', async () => {
    const work = makeWork({ variables: { kept: '上一章回写' } });
    const env = buildMacroEnv(work, undefined, { work: new Map(), global: new Map() }, { g: '配置里的全局' });
    expect(env.getVar('kept', 'work')).toBe('上一章回写');
    expect(env.getVar('g', 'global')).toBe('配置里的全局');
  });
});

describe('scanAndAssemble 预设文风按书覆盖', () => {
  it('全新书第 1 章：预设默认文风的变量同次组装即生效（<style> 块不再为空）', async () => {
    const all = await assemble(makeWork());
    expect(styleBlock(all)).toContain('具体参照<writing_style>内的文风要求');
    expect(all).toContain('日系轻小说：以对话推动');
    expect(all).toMatch(/核心文风（本书在主预设中选定的文风[\s\S]{0,120}日系轻小说/); // 默认文风同样提权
  });

  it('本书选老文系「短剧式」：第 1 章就注入短剧式全文，默认的 N-轻小说关闭', async () => {
    const all = await assemble(makeWork({ presetPromptOverrides: { 'short-drama': true } }));
    expect(styleBlock(all)).toContain('群体贬低→意外反转→震惊追悔');
    expect(all).not.toContain('日系轻小说：以对话推动');
    expect(all).not.toContain('具体参照<writing_style>内的文风要求'); // 旧文风的指针不再出现
    // 提权：所选文风正文同时进入要求块的最高优先级区
    //（A/B 实测：只留在预设原位置时，短剧式/鲁迅式/轻小说三种产出同一腔调）
    expect(all).toMatch(/核心文风（本书在主预设中选定的文风[\s\S]{0,120}群体贬低→意外反转→震惊追悔/);
  });

  it('换选「鲁迅式」：只注入鲁迅式，短剧式不并存', async () => {
    const all = await assemble(makeWork({ presetPromptOverrides: { 'short-drama': false, 'lu-xun': true } }));
    expect(styleBlock(all)).toContain('冷峻白描');
    expect(all).not.toContain('短剧式');
  });

  it('情感基调多选：默认「通用」保留，再勾「欢快」两条并存', async () => {
    const single = await assemble(makeWork());
    expect(single).toContain('基调: 自然平衡');
    expect(single).not.toContain('基调: 欢快明亮');
    const multi = await assemble(makeWork({ presetPromptOverrides: { 'tone-joy': true } }));
    expect(multi).toContain('基调: 自然平衡');
    expect(multi).toContain('基调: 欢快明亮');
  });

  it('注释宏全部清理，不残留进提示词', async () => {
    const all = await assemble(makeWork({ presetPromptOverrides: { 'short-drama': true } }));
    expect(all).not.toContain('{{//');
    expect(all).not.toContain('{{getvar');
  });
});
