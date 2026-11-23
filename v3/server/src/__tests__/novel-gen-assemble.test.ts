/**
 * M2 Task 3.1 测试：loadAssembleAssets 直读 / scanAndAssemble 组装产物 / mergeStylePresets / buildMacroEnv。
 * fixture 书 + 资产落临时 DATA_DIR（llm-tasks-m2.test.ts 同款隔离模式）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultNovelSettings, type NovelSettings, type Work } from '@shared/work';
import type { Message } from '@shared/message';

import { loadAssembleAssets } from '../services/novel-gen/assets';
import { buildMacroEnv, mergeStylePresets, scanAndAssemble, type PendingVars } from '../services/novel-gen/assemble';
import { workFile } from '../routes/works/works';
import { readJson, writeJsonAtomic } from '../storage/store';

let root = '';

const MAIN_PRESET_ID = 'preset-main-000001';
const STYLE_PRESET_ID = 'styabc123-style-0001';
const STYLE_UID = `sty${STYLE_PRESET_ID.slice(0, 6)}-style-block`; // 合并前缀规则：sty{id前6位}-
const CID = 'char-1';
const WBID = 'wb-const-1';
const FID = 'faction-1';
const IID = 'item-1';
const RID = 'regex-1';
const WID = 'work-it-1';

const PREFS = { source: 'openai' as const, model: 'gpt-4o', maxContext: 65536, maxTokens: 8192 };

/** Message 最小构造（scanAndAssemble 只读 content） */
function msg(id: string, content: string): Message {
  return { id, role: 'assistant', name: '小说家', content, createdAt: 1, swipes: [], swipeId: 0, extra: {} };
}

/** 固定资产 fixture 落盘（libraryDir 各子目录） */
async function seedAssets(): Promise<void> {
  await writeJsonAtomic(join(root, 'presets', `${MAIN_PRESET_ID}.json`), {
    id: MAIN_PRESET_ID,
    name: '主预设',
    raw: {
      prompts: [
        { identifier: 'main', name: '主', role: 'system', content: '你是小说作家，写兄妹亲情故事。', system_prompt: true },
        { identifier: 'worldInfoBefore', marker: true },
        { identifier: 'chatHistory', marker: true },
        { identifier: 'jailbreak', name: '收尾', role: 'system', content: '只输出正文。', system_prompt: true },
      ],
      prompt_order: [{
        character_id: 100001,
        order: ['main', 'worldInfoBefore', 'chatHistory', 'jailbreak'].map((identifier) => ({ identifier, enabled: true })),
      }],
    },
  });
  await writeJsonAtomic(join(root, 'presets', `${STYLE_PRESET_ID}.json`), {
    id: STYLE_PRESET_ID,
    name: '风格预设',
    raw: {
      prompts: [{ identifier: 'style-block', name: '风格', role: 'system', content: '文风要求：句子短促有力。', system_prompt: true }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'style-block', enabled: true }] }],
    },
  });
  await writeJsonAtomic(join(root, 'characters', `${CID}.json`), {
    id: CID, name: '林小妹', bio: '小传：自幼与哥哥相依为命。',
    card: { spec: 'chara_card_v2', spec_version: '2.0', data: { name: '林小妹', description: '妹妹卡描述。' } },
  });
  await writeJsonAtomic(join(root, 'worldbooks', `${WBID}.json`), {
    id: WBID, name: '世界观书',
    raw: { entries: { '0': { uid: 0, key: ['灵剑山'], content: '灵剑山是修真圣地。', constant: true, enabled: true, position: 0, order: 100 } } },
  });
  await writeJsonAtomic(join(root, 'factions', `${FID}.json`), {
    id: FID, name: '青云宗', description: '正道第一大宗。', members: ['张三'], relations: '与血魔殿敌对',
  });
  await writeJsonAtomic(join(root, 'items', `${IID}.json`), {
    id: IID, name: '母亲的银锁', summary: '母亲留下的遗物。', owner: '林小妹', texture: '温润羊脂玉',
  });
  await writeJsonAtomic(join(root, 'regex-scripts', `${RID}.json`), {
    id: RID,
    name: '去废话',
    raw: { scriptName: '去废话', findRegex: '顺便一提[\\s\\S]*?。', replaceString: '', promptOnly: true, disabled: false },
  });
}

function mkWork(overrides: Partial<Work> = {}, settings: Partial<NovelSettings> = {}): Work {
  return {
    id: WID,
    revision: 1,
    title: '测试书',
    mode: 'novel',
    genre: '兄妹',
    characterIds: [CID],
    worldbookIds: [WBID],
    factionIds: [FID],
    itemIds: [IID],
    presetId: MAIN_PRESET_ID,
    regexScriptIds: [RID],
    settings: { ...defaultNovelSettings, stylePresetIds: [STYLE_PRESET_ID], ...settings },
    voiceMap: {},
    stats: { messageCount: 0, chapterCount: 0, charCount: 0 },
    createdAt: 1, updatedAt: 1,
    ...overrides,
  } as Work;
}

async function seedWork(work: Work): Promise<void> {
  await writeJsonAtomic(workFile(work.id), work);
}

/** 组装入口快捷封装：loadAssembleAssets + buildMacroEnv + scanAndAssemble */
async function setupAndAssemble(work: Work, history: Message[], prefs: Record<string, unknown> = PREFS) {
  const assets = await loadAssembleAssets(work);
  const pending: PendingVars = { work: new Map(), global: new Map() };
  const env = buildMacroEnv(work, '林小妹', pending, {});
  return scanAndAssemble(work, history, { kind: 'directive', text: '写第一章' }, assets, env, prefs as typeof PREFS);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-novel-gen-assemble-'));
  process.env.DATA_DIR = root;
  await writeFile(join(root, 'secrets.json'), JSON.stringify({ openai: { apiKey: 'mock-key' } }), 'utf8');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe('loadAssembleAssets（server 直读 library）', () => {
  it('绑定资产全量装载：preset/cards+bios 同序/世界书+势力+物品伪书/正则', async () => {
    await seedAssets();
    const a = await loadAssembleAssets(mkWork());
    expect(a.preset?.prompts.some((p) => p.content?.includes('兄妹亲情故事'))).toBe(true); // preset 取 raw（酒馆原生格式）
    expect(a.cards[0]?.data.name).toBe('林小妹');
    expect(a.bios[0]).toContain('相依为命');
    const wbIds = a.worldbooks.map((b) => b.id);
    expect(wbIds).toContain(WBID);
    expect(wbIds).toContain('__factions__');
    expect(wbIds).toContain('__items__');
    expect(a.regexScripts[0]?.scriptName).toBe('去废话');
  });

  it('损坏/缺失资产文件静默跳过（不阻塞装载、cards/bios 序号同步收缩）', async () => {
    await seedAssets();
    await writeFile(join(root, 'characters', 'char-bad.json'), 'not-json{{', 'utf8');
    const a = await loadAssembleAssets(mkWork({ characterIds: [CID, 'char-bad', 'char-missing'] }));
    expect(a.cards.length).toBe(1);
    expect(a.bios.length).toBe(1);
    expect(a.cards[0]?.data.name).toBe('林小妹');
  });

  it('chapterIndex 给定时并入 active 且 fromChapter≤C 的绑定；缺省全量不并', async () => {
    await seedAssets();
    await writeJsonAtomic(join(root, 'worldbooks', 'wb-extra.json'), { id: 'wb-extra', name: '加更书', raw: { entries: {} } });
    const work = mkWork({
      bindings: [
        { assetId: 'wb-extra', kind: 'worldbook', fromChapter: 3, status: 'active' },
        { assetId: 'wb-missing', kind: 'worldbook', fromChapter: 1, status: 'pending' },
      ],
    } as Partial<Work>);
    const ids = (await loadAssembleAssets(work, 5)).worldbooks.map((b) => b.id);
    expect(ids).toContain('wb-extra'); // active 且 3≤5 → 并入
    expect(ids).not.toContain('wb-missing'); // pending 不入
    const baseIds = (await loadAssembleAssets(work)).worldbooks.map((b) => b.id);
    expect(baseIds).not.toContain('wb-extra'); // 缺省 chapterIndex 不做绑定合并
  });
});

describe('mergeStylePresets（附加预设合并）', () => {
  it('附加 prompts 注入主栈尾部 + identifier 前缀唯一化 + 主栈顺序不打乱', async () => {
    await seedAssets();
    const work = mkWork();
    const assets = await loadAssembleAssets(work);
    const merged = await mergeStylePresets(work, assets.preset!, PREFS);
    const added = merged.prompts.find((p) => p.identifier === STYLE_UID);
    expect(added?.content).toBe('文风要求：句子短促有力。');
    const order = merged.prompt_order?.[0]?.order ?? [];
    expect(order.map((o) => o.identifier).slice(0, 4)).toEqual(['main', 'worldInfoBefore', 'chatHistory', 'jailbreak']);
    expect(order.at(-1)?.identifier).toBe(STYLE_UID);
    expect(order.at(-1)?.enabled).toBe(true);
  });

  it('stylePresetIds 为空 → 原样返回；指向缺失文件 → 静默跳过不失败', async () => {
    await seedAssets();
    const work = mkWork({}, { stylePresetIds: [] });
    const assets = await loadAssembleAssets(work);
    const base = await mergeStylePresets(work, assets.preset!, PREFS);
    expect(base).toBe(assets.preset);
    const missing = mkWork({}, { stylePresetIds: ['no-such-preset'] });
    const merged = await mergeStylePresets(missing, assets.preset!, PREFS);
    expect(merged.prompts.some((p) => p.identifier.startsWith('sty'))).toBe(false);
  });
});

describe('scanAndAssemble（server 组装）', () => {
  it('①附加预设内容注入最终 messages（世界书 constant + 势力/物品伪书同路径激活）', async () => {
    await seedAssets();
    const out = await setupAndAssemble(mkWork(), []);
    const joined = out.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('兄妹亲情故事'); // 主预设 main
    expect(joined).toContain('句子短促有力'); // stylePresetIds 附加预设注入
    expect(joined).toContain('灵剑山是修真圣地'); // 世界书 constant 条目
    expect(joined).toContain('正道第一大宗'); // 势力伪书
    expect(joined).toContain('母亲留下的遗物'); // 物品伪书
    expect(out.activatedIds.some((id) => id.startsWith(`${WBID}:`))).toBe(true);
  });

  it('②超预算时最旧历史被截（tokenize 校验循环）', async () => {
    await seedAssets();
    const work = mkWork({}, { summaryUpTo: 999 }); // 预置游标：摘要不触发，隔离截断断言
    await seedWork(work);
    const history = [
      msg('h1', `最早的历史。${'远山'.repeat(150)}`),
      msg('h2', `中间的历史。${'流水'.repeat(150)}`),
      msg('h3', `最新的历史。${'近树'.repeat(150)}`),
    ];
    const prefs = { source: 'openai' as const, model: 'gpt-4o', maxContext: 1050, maxTokens: 50 };
    const out = await setupAndAssemble(work, history, prefs);
    const contents = out.messages.map((m) => m.content);
    // 历史消息本体被截（recall/skeleton hint 会以拼接文本带回片段，属失忆修复设计，不算本体在场）
    expect(contents).not.toContain(history[0].content);
    expect(out.messages.length).toBeGreaterThan(0);
  });

  it('③writingStyle=qidian + 基调 → 要求块含起点风写法指令与基调执行块', async () => {
    await seedAssets();
    const out = await setupAndAssemble(mkWork({}, { writingStyle: 'qidian', storyTones: ['温情治愈'] }), []);
    const joined = out.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('文风「起点·男频爽文」（全文执行）');
    expect(joined).toContain('至少落一个可感的爽点'); // 写法级指令（A/B 实测：旧标签版不起作用）
    expect(joined).toContain('基调「温情治愈」');
    expect(joined).not.toContain('叙事语言质感全程贴合'); // 旧的一句标签式措辞已移除
  });

  it('③b 自定义文风（UI 路径 writingStyle=custom）→ 原文以「全文每一句都须遵循」注入要求块，无内置指令', async () => {
    await seedAssets();
    const out = await setupAndAssemble(mkWork({}, { writingStyle: 'custom', customWritingStyle: ' 自定义文风X ' }), []);
    const joined = out.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('文风规范（全文每一句都须遵循）：自定义文风X');
    expect(joined).not.toContain('须遵循）： 自定义文风X'); // 原文 trim，冒号后无多余空格
    expect(joined).not.toContain('至少落一个可感的爽点');
  });

  it('④历史超预算触发滚动摘要：LLM 调用 + 摘要注入 + rollingSummary/summaryUpTo 直写落盘', async () => {
    const fetchSpy = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '  这是滚动摘要内容。 ' } }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await seedAssets();
    const work = mkWork();
    await seedWork(work);
    const history = [msg('h1', `旧章。${'回忆'.repeat(300)}`), msg('h2', `新章。${'当下'.repeat(100)}`)];
    const prefs = { source: 'openai' as const, model: 'gpt-4o', maxContext: 700, maxTokens: 50 };
    const out = await setupAndAssemble(work, history, prefs);
    expect(fetchSpy).toHaveBeenCalled();
    const disk = await readJson<{ settings: { rollingSummary?: string; summaryUpTo?: number } }>(workFile(WID));
    expect(disk?.settings.rollingSummary).toBe('这是滚动摘要内容。'); // trim 后落盘
    expect(disk?.settings.summaryUpTo).toBe(1);
    const joined = out.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('这是滚动摘要内容'); // 摘要块注入本次组装
  });

  it('⑤摘要 LLM 失败 → 静默跳过（磁盘不写、组装照常完成）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('boom', { status: 500 })));
    await seedAssets();
    const work = mkWork();
    await seedWork(work);
    const history = [msg('h1', `旧章。${'回忆'.repeat(300)}`), msg('h2', `新章。${'当下'.repeat(100)}`)];
    const prefs = { source: 'openai' as const, model: 'gpt-4o', maxContext: 700, maxTokens: 50 };
    const out = await setupAndAssemble(work, history, prefs);
    const disk = await readJson<{ settings: { rollingSummary?: string } }>(workFile(WID));
    expect(disk?.settings.rollingSummary).toBeUndefined();
    expect(out.messages.length).toBeGreaterThan(0);
  });
});

describe('buildMacroEnv（server 变量读写）', () => {
  it('work 级读 settings.variables；global 级读传入 config 快照；setVar 落暂存', () => {
    const work = mkWork({}, { variables: { 时间: '深夜' } });
    const pending: PendingVars = { work: new Map(), global: new Map() };
    const env = buildMacroEnv(work, '林小妹', pending, { 地点: '北境', 数字: 42 });
    expect(env.user).toBe('作者');
    expect(env.char).toBe('林小妹');
    expect(env.getVar('时间', 'work')).toBe('深夜');
    expect(env.getVar('地点', 'global')).toBe('北境');
    expect(env.getVar('数字', 'global')).toBeUndefined(); // 非字符串值不透出（client 版同语义）
    expect(env.getVar('缺失', 'global')).toBeUndefined();
    env.setVar('a', '1', 'work');
    env.setVar('b', '2', 'global');
    expect(pending.work.get('a')).toBe('1');
    expect(pending.global.get('b')).toBe('2');
    expect(env.scope).toBe('work');
  });

  it('无主卡名 → char 兜底「小说家」', () => {
    const env = buildMacroEnv(mkWork(), undefined, { work: new Map(), global: new Map() }, {});
    expect(env.char).toBe('小说家');
  });
});
