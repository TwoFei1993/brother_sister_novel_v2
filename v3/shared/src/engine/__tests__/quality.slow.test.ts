/**
 * 真实生成质量测试（5 场景 × 5 章，MiniMax-M3 端到端实测）
 *
 * 默认整体跳过（不污染 CI）；真实运行（消耗 LLM 额度，需本地后端 :3001）：
 *   QUALITY_RUN=1 npx vitest run quality.slow
 *
 * 链路：登录 → 建作品（带绑定）→ engine 纯函数组装（scanWorldInfo + assemblePrompt）
 * → /api/llm/generate SSE → postprocessMessage 后处理 → 幂等入库 → 全量历史续写下一章。
 * 断言经 recorder.check 收集（全量执行后聚合判定，保证 5 章都生成并入库）；
 * 全章原文/断言矩阵落盘 test-results/quality-artifacts.json（gitignore 内）供报告摘录。
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { Message } from '@shared/message';
import type { TavernCardV2, TavernPreset, TavernRegexScript } from '@shared/tavern';
import type { WorldbookAsset } from '@shared/worldbook';

import {
  api,
  applyDisplayTrack,
  assemble,
  buildAssistantTurn,
  buildChapterMessage,
  buildUserTurn,
  chatMacroEnv,
  createWork,
  generateStream,
  login,
  novelMacroEnv,
  postprocessChat,
  postprocessNovel,
  SCENE_TIMEOUT,
  type AssembleAssets,
} from './quality-helpers';
import { charCount, recorder } from './quality-assert';

const SKIP = !process.env.QUALITY_RUN;
const MACRO_RESIDUE = /\{\{(char|user)\}\}/;
const THINK_RESIDUE = /<think/i;

/** 正文首句摘录（报告人工审阅用） */
const firstSentence = (t: string): string => (t.trim().split(/(?<=[。！？!\n])/)[0] ?? t).trim().slice(0, 80);

// ---------- 资产定位（按名查 id，避免 uuid 硬编码失效） ----------

interface SceneAssets {
  brother: TavernCardV2;
  sister: TavernCardV2;
  seraphina: TavernCardV2;
  hogwarts: WorldbookAsset;
  eldoria: WorldbookAsset;
  sudachi: TavernPreset;
  rxThinking: TavernRegexScript;
  rxCollapse: TavernRegexScript;
  rxBold: TavernRegexScript;
  /** 各资产入库 id（作品绑定用；卡/预设/正则的 tavern raw 本身不含 id） */
  ids: Record<'brother' | 'sister' | 'seraphina' | 'hogwarts' | 'eldoria' | 'sudachi' | 'rxThinking' | 'rxCollapse' | 'rxBold', string>;
}

async function loadSceneAssets(): Promise<SceneAssets> {
  const pick = <T extends { id: string; name: string }>(list: T[], name: string, label: string): T => {
    const hit = list.find((a) => a.name === name);
    if (!hit) throw new Error(`资产库缺少「${name}」（${label}）`);
    return hit;
  };
  const chars = await api<Array<{ id: string; name: string }>>('/api/characters');
  const wbs = await api<Array<{ id: string; name: string }>>('/api/worldbooks');
  const presets = await api<Array<{ id: string; name: string }>>('/api/presets');
  const rxs = await api<Array<{ id: string; name: string }>>('/api/regex-scripts');
  const refBrother = pick(chars, '哥哥', '角色卡');
  const refSister = pick(chars, '妹妹', '角色卡');
  const refSeraphina = pick(chars, 'Seraphina', '角色卡');
  const refHogwarts = pick(wbs, '霍格沃茨', '世界书');
  const refEldoria = pick(wbs, '艾尔多利亚森林（中文示例）', '世界书');
  const refSudachi = pick(presets, 'Sudachi-Next-Preset', '预设');
  const refThinking = pick(rxs, 'remove-thinking', '正则');
  const refCollapse = pick(rxs, 'collapse-blank-lines', '正则');
  const refBold = pick(rxs, 'bold-quotes', '正则');
  const card = (id: string) => api<{ card: TavernCardV2 }>(`/api/characters/${id}`).then((a) => a.card);
  const [brother, sister, seraphina, hogwarts, eldoria, sudachi, rxThinking, rxCollapse, rxBold] = await Promise.all([
    card(refBrother.id),
    card(refSister.id),
    card(refSeraphina.id),
    api<WorldbookAsset>(`/api/worldbooks/${refHogwarts.id}`),
    api<WorldbookAsset>(`/api/worldbooks/${refEldoria.id}`),
    api<{ raw: TavernPreset }>(`/api/presets/${refSudachi.id}`).then((a) => a.raw),
    api<{ raw: TavernRegexScript }>(`/api/regex-scripts/${refThinking.id}`).then((a) => a.raw),
    api<{ raw: TavernRegexScript }>(`/api/regex-scripts/${refCollapse.id}`).then((a) => a.raw),
    api<{ raw: TavernRegexScript }>(`/api/regex-scripts/${refBold.id}`).then((a) => a.raw),
  ]);
  return {
    brother, sister, seraphina, hogwarts, eldoria, sudachi, rxThinking, rxCollapse, rxBold,
    ids: {
      brother: refBrother.id, sister: refSister.id, seraphina: refSeraphina.id,
      hogwarts: refHogwarts.id, eldoria: refEldoria.id, sudachi: refSudachi.id,
      rxThinking: refThinking.id, rxCollapse: refCollapse.id, rxBold: refBold.id,
    },
  };
}

// ---------- novel/chat 场景执行器 ----------

interface NovelChapter {
  index: number;
  title: string;
  titleSource: 'model' | 'fallback';
  content: string;
  raw: string;
  chars: number;
  activatedIds: string[];
  rawHadThinkTag: boolean;
}

/** novel 生成循环：逐章组装 → SSE 生成 → 后处理 → 入库 → 全量历史续写（断言后置由调用方收集） */
async function runNovelScene(opts: {
  scene: string;
  workTitle: string;
  assets: AssembleAssets;
  binds: { characterIds?: string[]; worldbookIds?: string[]; presetId?: string; regexScriptIds?: string[] };
  directives: string[];
}): Promise<{ workId: string; chapters: NovelChapter[] }> {
  const env = novelMacroEnv(opts.assets.cards[0]?.data?.name ?? undefined);
  const work = await createWork({ title: opts.workTitle, mode: 'novel', ...opts.binds });
  const history: Message[] = [];
  const chapters: NovelChapter[] = [];
  for (let i = 0; i < opts.directives.length; i += 1) {
    const directive = opts.directives[i];
    const asm = assemble({ assets: opts.assets, history, tail: { kind: 'directive', text: directive }, macroEnv: env });
    const gen = await generateStream(asm.messages);
    const pp = postprocessNovel(gen.text, directive, i, opts.assets.regexScripts, env);
    const chapter: NovelChapter = {
      index: i + 1,
      title: pp.title,
      titleSource: /^\s*#\s*\S/.test(gen.text) ? 'model' : 'fallback',
      content: pp.content,
      raw: gen.text,
      chars: charCount(pp.content),
      activatedIds: asm.activatedIds,
      rawHadThinkTag: THINK_RESIDUE.test(gen.text),
    };
    const msg = buildChapterMessage({
      content: pp.content,
      title: pp.title,
      chapterIndex: i + 1,
      directive,
      promptTokens: asm.promptTokens,
      generationMs: gen.ms,
      activatedEntries: asm.activatedIds,
    });
    await api(`/api/works/${work.id}/messages`, { method: 'POST', body: JSON.stringify(msg) });
    history.push(msg);
    chapters.push(chapter);
    recorder.chapter({
      scene: opts.scene,
      index: chapter.index,
      title: chapter.title,
      titleSource: chapter.titleSource,
      chars: chapter.chars,
      firstSentence: firstSentence(chapter.content),
      directive,
      activatedIds: chapter.activatedIds,
      rawHadThinkTag: chapter.rawHadThinkTag,
      usage: gen.usage,
      promptTokens: asm.promptTokens,
      generationMs: gen.ms,
      content: chapter.content,
    });
  }
  return { workId: work.id, chapters };
}

/** chat 生成循环：userMessage 通道 → 成对入库（user「用户」+ assistant 角色名） */
async function runChatScene(opts: {
  scene: string;
  workTitle: string;
  assets: AssembleAssets;
  speaker: TavernCardV2;
  speakerId: string;
  userMessages: string[];
}): Promise<{ workId: string; turns: Array<{ content: string; name: string; activatedIds: string[] }> }> {
  const env = chatMacroEnv(opts.speaker.data.name ?? '');
  const work = await createWork({
    title: opts.workTitle,
    mode: 'chat',
    characterIds: [opts.speakerId],
    worldbookIds: opts.assets.worldbooks.map((b) => b.id),
  });
  const history: Message[] = [];
  const turns: Array<{ content: string; name: string; activatedIds: string[] }> = [];
  for (const text of opts.userMessages) {
    const userMsg = buildUserTurn(text);
    const asm = assemble({ assets: opts.assets, history, tail: { kind: 'userMessage', text }, macroEnv: env });
    const gen = await generateStream(asm.messages);
    const pp = postprocessChat(gen.text, opts.assets.regexScripts, env);
    const assistant = buildAssistantTurn({
      content: pp.content,
      speakerName: opts.speaker.data.name ?? '',
      promptTokens: asm.promptTokens,
      generationMs: gen.ms,
      activatedEntries: asm.activatedIds,
    });
    await api(`/api/works/${work.id}/messages`, { method: 'POST', body: JSON.stringify(userMsg) });
    await api(`/api/works/${work.id}/messages`, { method: 'POST', body: JSON.stringify(assistant) });
    history.push(userMsg, assistant);
    turns.push({ content: pp.content, name: assistant.name, activatedIds: asm.activatedIds });
    recorder.chapter({
      scene: opts.scene,
      index: turns.length,
      title: `第${turns.length}轮`,
      titleSource: 'fallback',
      chars: charCount(pp.content),
      firstSentence: firstSentence(pp.content),
      directive: text,
      activatedIds: asm.activatedIds,
      rawHadThinkTag: THINK_RESIDUE.test(gen.text),
      usage: gen.usage,
      promptTokens: asm.promptTokens,
      generationMs: gen.ms,
      content: pp.content,
    });
  }
  return { workId: work.id, turns };
}

// ---------- 五个场景 ----------

describe.skipIf(SKIP)('质量测试 T1-T5（MiniMax-M3 真实生成）', () => {
  let assets: SceneAssets;

  afterAll(() => {
    recorder.flush();
  });

  it(
    '准备：登录并拉取资产',
    async () => {
      await login();
      assets = await loadSceneAssets();
      expect(assets.brother.data.name).toBe('哥哥');
      expect(assets.sister.data.name).toBe('妹妹');
      expect(assets.seraphina.data.name).toBe('Seraphina');
      expect(Object.keys(assets.hogwarts.raw.entries).length).toBeGreaterThanOrEqual(9);
    },
    60_000,
  );

  it(
    'T1 基础互动小说：兄妹逃亡五幕（双卡 novel）',
    async () => {
      const scene = 'T1';
      const assets1: AssembleAssets = { preset: null, cards: [assets.brother, assets.sister], worldbooks: [], regexScripts: [] };
      const { workId, chapters } = await runNovelScene({
        scene,
        workTitle: '质检T1-兄妹逃亡',
        assets: assets1,
        binds: { characterIds: [assets.ids.brother, assets.ids.sister] },
        directives: [
          '开篇：兄妹二人在暴雨夜被家族追杀，逃入废墟',
          '妹妹的玉佩发出光芒，引出伏笔',
          '追兵首领现身，是家族二叔',
          '兄妹决裂：哥哥要回头复仇，妹妹坚持逃亡',
          '和解，共同面对追兵',
        ],
      });

      // 入库验证：5 条 assistant 章节消息且都有标题
      const stored = await api<{ messages: Message[] }>(`/api/works/${workId}/messages?tail=100`);
      recorder.check(scene, '5 条 assistant 消息入库', stored.messages.length === 5 && stored.messages.every((m) => m.role === 'assistant'), `实际 ${stored.messages.length} 条`);
      recorder.check(scene, '每条消息都有 chapter.title', stored.messages.every((m) => m.chapter?.title), stored.messages.map((m) => m.chapter?.title ?? '(无)').join(' / '));
      recorder.check(scene, '章节正文 ≥600 字', chapters.every((c) => c.chars >= 600), chapters.map((c) => `第${c.index}章${c.chars}字`).join('，'));
      const bothNames = chapters.filter((c) => c.content.includes('哥哥') && c.content.includes('妹妹')).length;
      recorder.check(scene, '「哥哥/妹妹」称呼 ≥3 章同时出现', bothNames >= 3, `${bothNames}/5 章`);
      recorder.check(scene, '第 5 章含和解语义词（和/原谅/一起）', /和|原谅|一起/.test(chapters[4].content), chapters[4].content.slice(0, 60));
      recorder.check(scene, '无 {{char}}/{{user}} 字面量残留', chapters.every((c) => !MACRO_RESIDUE.test(c.content)));
      recorder.check(scene, '无 <think 残留', chapters.every((c) => !THINK_RESIDUE.test(c.content)));
      recorder.check(scene, '模型自产章节标题（记录项）', true, `${chapters.filter((c) => c.titleSource === 'model').length}/5 章`);
      expect(recorder.failuresOf(scene)).toEqual([]);
    },
    SCENE_TIMEOUT,
  );

  it(
    'T2 世界书触发：霍格沃茨五幕（无卡 novel）',
    async () => {
      const scene = 'T2';
      const assets2: AssembleAssets = { preset: null, cards: [], worldbooks: [assets.hogwarts], regexScripts: [] };
      const { chapters } = await runNovelScene({
        scene,
        workTitle: '质检T2-霍格沃茨入学',
        assets: assets2,
        binds: { worldbookIds: [assets.ids.hogwarts] },
        directives: [
          '主角收到霍格沃茨入学信',
          '在对角巷购买魔杖，遇见魔法部傲罗巡查',
          '分院帽犹豫良久',
          '第一次魁地奇训练，金色飞贼极难捉',
          '禁林边缘发现神秘符文',
        ],
      });
      const uidActive = (c: NovelChapter, uid: number): boolean => c.activatedIds.some((id) => id.endsWith(`:${uid}`));
      recorder.check(scene, '第 1 章激活常驻条目 uid 0', uidActive(chapters[0], 0), chapters[0].activatedIds.join(','));
      recorder.check(scene, '第 2 章激活魔法部条目 uid 6', uidActive(chapters[1], 6), chapters[1].activatedIds.join(','));
      recorder.check(scene, '第 4 章激活魁地奇条目 uid 8', uidActive(chapters[3], 8), chapters[3].activatedIds.join(','));
      recorder.check(scene, '第 2 章正文出现傲罗/魔法部设定词', /傲罗|魔法部/.test(chapters[1].content));
      recorder.check(scene, '第 3 章正文出现分院帽', chapters[2].content.includes('分院帽'));
      recorder.check(scene, '第 4 章正文出现飞贼/魁地奇', /飞贼|魁地奇/.test(chapters[3].content));
      recorder.check(scene, '每章正文 ≥500 字', chapters.every((c) => c.chars >= 500), chapters.map((c) => `第${c.index}章${c.chars}字`).join('，'));
      recorder.check(scene, '无 <think 残留', chapters.every((c) => !THINK_RESIDUE.test(c.content)));
      expect(recorder.failuresOf(scene)).toEqual([]);
    },
    SCENE_TIMEOUT,
  );

  it(
    'T3 正则清洗：思考标签诱导 + 三脚本清洗（novel）',
    async () => {
      const scene = 'T3';
      const rxScripts = [assets.rxThinking, assets.rxCollapse, assets.rxBold];
      const assets3: AssembleAssets = { preset: null, cards: [], worldbooks: [], regexScripts: rxScripts };
      const thinkNote = '先在 <thinking> 标签内列出本章要点再写正文。';
      const { workId, chapters } = await runNovelScene({
        scene,
        workTitle: '质检T3-便利店谜影',
        assets: assets3,
        binds: { regexScriptIds: [assets.ids.rxThinking, assets.ids.rxCollapse, assets.ids.rxBold] },
        directives: [
          '开篇：深夜便利店店员林秋发现收银台多出一张不属于任何顾客的小票' + thinkNote,
          '小票背面的电话号码打过去，听到自己的声音' + thinkNote,
          '监控录像里出现第二个林秋' + thinkNote,
          '林秋跟随第二个自己走进储物间后的暗门' + thinkNote,
          '真相揭露：两个林秋必须只留下一个' + thinkNote,
        ],
      });
      const thinkProduced = chapters.filter((c) => c.rawHadThinkTag).length;
      recorder.check(scene, '入库 content 无 <think 开标签残留', chapters.every((c) => !THINK_RESIDUE.test(c.content)));
      recorder.check(scene, '思考块产生情况（信息记录，不产生时断言降级）', true, `${thinkProduced}/5 章 raw 含 <thinking> 块${thinkProduced === 0 ? '（模型未遵从指令，无残留断言恒真）' : ''}`);

      // 渲染轨（markdownOnly 脚本：collapse-blank-lines / bold-quotes 只作用于阅读视图）
      const rendered = chapters.map((c) => applyDisplayTrack(c.content, rxScripts));
      recorder.check(scene, '渲染轨后无 3+ 连续换行（collapse-blank-lines 生效）', rendered.every((t) => !/\n{3,}/.test(t)));
      const dialogChapters = rendered.filter((t) => /「[^」]{1,200}」/.test(t)).length;
      const bolded = rendered.filter((t) => /\*\*「[^」]+」\*\*/.test(t)).length;
      recorder.check(scene, '渲染轨后含加粗对话（bold-quotes 生效）', bolded > 0 || dialogChapters === 0, `${bolded}/${dialogChapters || '0'} 个对话章被加粗`);
      // 入库视角：全时轨不应用渲染轨脚本属设计行为（防历史二次替换），记录入库原文空行状态
      const stored = await api<{ messages: Message[] }>(`/api/works/${workId}/messages?tail=100`);
      recorder.check(scene, '入库消息 5 条', stored.messages.length === 5, `实际 ${stored.messages.length}`);
      expect(recorder.failuresOf(scene)).toEqual([]);
    },
    SCENE_TIMEOUT,
  );

  it(
    'T4 社区预设 Sudachi：预设 main 生效 + 都市日常五幕',
    async () => {
      const scene = 'T4';
      const assets4: AssembleAssets = { preset: assets.sudachi, cards: [assets.brother], worldbooks: [], regexScripts: [] };
      const env = novelMacroEnv('哥哥');
      // 组装层断言：预设 main 进入 system 首（Sudachi order 首条为使用指南 prompt，main 紧随其后）
      const asm = assemble({ assets: assets4, history: [], tail: { kind: 'directive', text: '开篇' }, macroEnv: env });
      const headSystems = asm.messages.slice(0, 5).filter((m) => m.role === 'system');
      recorder.check(scene, '组装后前 5 条 system 含 "Sudachi"（预设 main 生效）', headSystems.some((m) => m.content.includes('Sudachi')), `首条 system 前 40 字：${(headSystems[0]?.content ?? '').slice(0, 40).replace(/\n/g, ' ')}`);
      recorder.check(scene, '组装后无 {{char}}/{{user}} 残留（宏替换生效）', asm.messages.every((m) => !MACRO_RESIDUE.test(m.content)));

      const { chapters } = await runNovelScene({
        scene,
        workTitle: '质检T4-兄妹都市日常',
        assets: assets4,
        binds: { characterIds: [assets.ids.brother], presetId: assets.ids.sudachi },
        directives: [
          '开篇：兄长与妹妹在老城区的面馆吃晚饭，回忆已故父母',
          '妹妹在学校被人欺负，兄长到校讨说法',
          '兄长公司裁员，隐瞒妹妹装作正常上班',
          '妹妹发现真相，偷偷打工补贴家用',
          '兄妹坦白彼此的隐瞒，决定一起撑过难关',
        ],
      });
      recorder.check(scene, '5 章生成成功且正文非空', chapters.every((c) => c.chars >= 100), chapters.map((c) => `第${c.index}章${c.chars}字`).join('，'));
      recorder.check(scene, '无 <think 残留', chapters.every((c) => !THINK_RESIDUE.test(c.content)));
      recorder.check(scene, '含 <thinking> 块情况（信息记录）', true, `${chapters.filter((c) => c.rawHadThinkTag).length}/5 章 raw 含思考块`);
      expect(recorder.failuresOf(scene)).toEqual([]);
    },
    SCENE_TIMEOUT,
  );

  it(
    'T5 对话写作：Seraphina 五轮（chat + 中文世界书触发）',
    async () => {
      const scene = 'T5';
      const assets5: AssembleAssets = { preset: null, cards: [assets.seraphina], worldbooks: [assets.eldoria], regexScripts: [] };
      const { workId, turns } = await runChatScene({
        scene,
        workTitle: '质检T5-与Seraphina对话',
        assets: assets5,
        speaker: assets.seraphina,
        speakerId: assets.ids.seraphina,
        userMessages: [
          '你好，我是谁？这是哪里？',
          '森林外面有什么危险？',
          '影牙到底是什么？',
          '你的魔法能教我吗？',
          '我该留下来还是离开？',
        ],
      });
      recorder.check(scene, '每轮 assistant name=Seraphina', turns.every((t) => t.name === 'Seraphina'), turns.map((t) => t.name).join(','));
      recorder.check(scene, '回复无 {{char}}/{{user}} 字面量', turns.every((t) => !MACRO_RESIDUE.test(t.content)));
      recorder.check(scene, '每轮回复非空（≥50 字）', turns.every((t) => charCount(t.content) >= 50), turns.map((t, i) => `第${i + 1}轮${charCount(t.content)}字`).join('，'));
      const uid1 = turns[2].activatedIds.some((id) => id.endsWith(':1'));
      recorder.check(scene, '第 3 轮激活影牙条目 uid 1（中文关键词触发）', uid1, turns[2].activatedIds.join(','));
      // 连贯性信息记录：第 5 轮是否提及前文要素（影牙/森林/魔法），人工复核摘录进报告
      const t5 = turns[4].content;
      const mentions = ['影牙', '森林', '魔法'].filter((k) => t5.includes(k));
      recorder.check(scene, '第 5 轮提及前文要素（连贯性参考）', mentions.length >= 1, `提及：${mentions.join('/') || '无'}；全文见 artifacts`);
      const stored = await api<{ messages: Message[] }>(`/api/works/${workId}/messages?tail=100`);
      recorder.check(scene, '10 条消息成对入库（5 user + 5 assistant）', stored.messages.length === 10, `实际 ${stored.messages.length}`);
      expect(recorder.failuresOf(scene)).toEqual([]);
    },
    SCENE_TIMEOUT,
  );
});
