/**
 * scanAndAssemble 章节大纲联动注入测试（Word 导入实测反馈）：
 * work.settings.chapterOutlines 含第 N 章条目时，novel directive 末尾追加
 * 「（本章大纲：标题《…》；剧情要点：…）」；无条目 / chat userMessage 通道不追加。
 * tokenize 走模块 mock（预算校验路径），其余组装逻辑全真实。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/llm', () => ({
  tokenizeMessages: vi.fn(async () => ({ count: 100 })),
}));

import { scanAndAssemble, buildMacroEnv, type AssembleAssets, type PendingVars } from '../generation-pipeline';
import type { AssembleTail } from '../context-plan';
import type { LlmPrefs } from '../../stores/settings';
import { defaultNovelSettings, type Work } from '@shared/work';
import type { Message } from '@shared/message';

const PREFS: LlmPrefs = { source: 'claude', model: 'MiniMax-M3', maxContext: 100000, maxTokens: 8192, temperature: 0.8 };

const ASSETS: AssembleAssets = { preset: null, cards: [], worldbooks: [], factions: [], regexScripts: [] };

function workFixture(chapterOutlines: Work['settings']['chapterOutlines']): Work {
  return {
    id: 'w1',
    revision: 0,
    title: '大纲联动测试',
    mode: 'novel',
    genre: 'chuanyue',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    voiceMap: {},
    settings: { ...defaultNovelSettings, chapterOutlines },
    createdAt: 0,
    updatedAt: 0,
  };
}

function envFor(work: Work) {
  const pending: PendingVars = { work: new Map(), global: new Map() };
  return buildMacroEnv(work, undefined, pending);
}

const allText = (msgs: { content: string }[]): string => msgs.map((m) => m.content).join('\n');

describe('scanAndAssemble 章节大纲联动', () => {
  it('第 1 章生成（messages 空）：directive 末尾追加本章大纲要点', async () => {
    const work = workFixture([{ index: 1, title: '落地嫡长，方寸藏天机', plot: '女主胎穿嫡长女，隐藏金手指' }]);
    const tail: AssembleTail = { kind: 'directive', text: '写第一章' };
    const fitted = await scanAndAssemble(work, [] as Message[], tail, ASSETS, envFor(work), PREFS);
    const text = allText(fitted.messages);
    expect(text).toContain('（本章大纲：标题《落地嫡长，方寸藏天机》；剧情要点：女主胎穿嫡长女，隐藏金手指）');
    expect(text).toContain('写第一章');
  });

  it('按下一章号匹配：已有 1 章历史时注入第 2 章大纲', async () => {
    const history: Message[] = [
      {
        id: 'm1',
        role: 'assistant',
        content: '第一章正文',
        timestamp: 1,
        chapter: { index: 1, title: '落地嫡长' },
      } as unknown as Message,
    ];
    const work = workFixture([{ index: 2, title: '稚子无声，私囤万千', plot: '幼年囤积物资' }]);
    const tail: AssembleTail = { kind: 'directive', text: '继续写' };
    const fitted = await scanAndAssemble(work, history, tail, ASSETS, envFor(work), PREFS);
    expect(allText(fitted.messages)).toContain('（本章大纲：标题《稚子无声，私囤万千》；剧情要点：幼年囤积物资）');
  });

  it('无 chapterOutlines：不注入任何大纲文本', async () => {
    const work = workFixture(undefined);
    const tail: AssembleTail = { kind: 'directive', text: '写第一章' };
    const fitted = await scanAndAssemble(work, [], tail, ASSETS, envFor(work), PREFS);
    expect(allText(fitted.messages)).not.toContain('本章大纲');
  });

  it('chat 通道（userMessage）：即使有大纲也不注入', async () => {
    const work = workFixture([{ index: 1, title: '落地嫡长', plot: '胎穿' }]);
    const tail: AssembleTail = { kind: 'userMessage', text: '你好' };
    const fitted = await scanAndAssemble(work, [], tail, ASSETS, envFor(work), PREFS);
    expect(allText(fitted.messages)).not.toContain('本章大纲');
  });
});
