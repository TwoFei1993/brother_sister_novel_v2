/**
 * 装配总装测试（设计 §5.1④ / §4.4 卡覆盖）
 * 锚点：酒馆 openai.js populationInjectionPrompts(:810)——messages 倒序数组、
 * 按 depth 遍历 splice(i + totalInserted)、同 depth 按 order 降序分组、
 * 组内 role system→user→assistant，末尾 reverse 回正序；
 * preparePromptsForChatCompletion(:1498)——卡 system_prompt/PHI 覆盖 main/jailbreak。
 */
import { describe, expect, it } from 'vitest';

import { defaultNovelSettings } from '@shared/work';

import { assemblePrompt } from '../prompt/assemble';
import {
  EMPTY_SCAN,
  STD_ORDER,
  STD_PROMPTS,
  makeCard,
  makeCtx,
  makeHistory,
  makePreset,
  tags,
} from './assemble-fixtures';

// ---------- prompt_order 装填顺序 ----------

describe('assemblePrompt 基本装填', () => {
  it('prompt_order 顺序：main→世界书前→角色→性格→场景→世界书后→摘要→历史→jailbreak', () => {
    const result = assemblePrompt(
      makeCtx({
        worldbookScan: { ...EMPTY_SCAN, before: ['世界前条目'], after: ['世界后条目'] },
        summary: '前文摘要文本',
      }),
    );
    const contents = result.messages.map((m) => m.content);
    expect(contents).toHaveLength(10);
    expect(contents[0]).toBe('MAIN默认主提示');
    expect(contents[1]).toBe('世界前条目');
    expect(contents[2]).toBe('卡描述');
    expect(contents[3]).toBe('卡性格');
    // scenario 块 = 卡 scenario + 设定块（【作品设定】概要）
    expect(contents[4].startsWith('卡场景')).toBe(true);
    expect(contents[4]).toContain('【作品设定】');
    expect(contents[5]).toBe('世界后条目');
    expect(contents[6]).toBe('【前文摘要】\n前文摘要文本');
    expect(contents[7]).toBe('历史一');
    expect(contents[8]).toBe('历史二');
    expect(contents[9]).toBe('JB默认越狱');
  });

  it('未启用的 marker 与空素材块不产生消息；activatedIds 透传', () => {
    const order = STD_ORDER.map((o) => (o.identifier === 'jailbreak' ? { ...o, enabled: false } : o));
    const result = assemblePrompt(
      makeCtx({
        preset: makePreset(STD_PROMPTS, order),
        cards: [makeCard()], // 无 description/personality/scenario
        worldbookScan: { ...EMPTY_SCAN, activatedIds: ['b1:0'] },
      }),
    );
    const contents = result.messages.map((m) => m.content);
    expect(contents.some((c) => c.includes('JB默认越狱'))).toBe(false);
    expect(contents.some((c) => c.includes('卡描述'))).toBe(false);
    expect(result.activatedIds).toEqual(['b1:0']);
  });
});

// ---------- 卡覆盖（设计 §4.4） ----------

describe('assemblePrompt 卡覆盖', () => {
  it('allowCardOverride 时卡 system_prompt 替换 main 内容', () => {
    const result = assemblePrompt(makeCtx({ cards: [makeCard({ system_prompt: '卡主提示' })] }));
    expect(result.messages[0].content).toBe('卡主提示');
    expect(result.messages[0].content).not.toContain('MAIN默认');
  });

  it('多卡取首张非空 system_prompt', () => {
    const result = assemblePrompt(
      makeCtx({
        cards: [makeCard({ system_prompt: '' }), makeCard({ system_prompt: '卡B主提示' })],
      }),
    );
    expect(result.messages[0].content).toBe('卡B主提示');
  });

  it('开关关闭不替换：预设 main 原样使用', () => {
    const result = assemblePrompt(
      makeCtx({ allowCardOverride: false, cards: [makeCard({ system_prompt: '卡主提示' })] }),
    );
    expect(result.messages[0].content).toBe('MAIN默认主提示');
  });

  it('卡 post_history_instructions 替换 jailbreak', () => {
    const result = assemblePrompt(
      makeCtx({ cards: [makeCard({ post_history_instructions: '卡越狱' })] }),
    );
    const last = result.messages[result.messages.length - 1];
    expect(last.content).toBe('卡越狱');
  });
});

// ---------- 深度注入（对齐 populationInjectionPrompts） ----------

describe('assemblePrompt 深度注入', () => {
  it('depth=1 注入到倒数第 1 条之前（最后一条消息之前）', () => {
    const result = assemblePrompt(
      makeCtx({
        cards: [makeCard()], // 空卡：聚焦注入位置断言
        history: makeHistory(['h1', 'h2', 'h3']),
        worldbookScan: {
          ...EMPTY_SCAN,
          depthEntries: [{ content: '深度注入', depth: 1, role: 'system', order: 100 }],
        },
      }),
    );
    expect(tags(result.messages)).toEqual([
      'MAIN默认主提示',
      '【作品设定】\n题材：异世',
      'h1',
      'h2',
      '深度注入',
      'h3',
      'JB默认越狱',
    ]);
  });

  it('depth=0 注入在最后一条消息之后', () => {
    const result = assemblePrompt(
      makeCtx({
        cards: [makeCard()],
        history: makeHistory(['h1', 'h2']),
        worldbookScan: {
          ...EMPTY_SCAN,
          depthEntries: [{ content: '末尾注入', depth: 0, role: 'system', order: 100 }],
        },
      }),
    );
    expect(tags(result.messages)).toEqual([
      'MAIN默认主提示',
      '【作品设定】\n题材：异世',
      'h1',
      'h2',
      '末尾注入',
      'JB默认越狱',
    ]);
  });

  it('同 depth 按 order 降序分组：order 高者更靠近历史尾部（酒馆语义）', () => {
    const result = assemblePrompt(
      makeCtx({
        history: makeHistory(['h1', 'h2', 'h3']),
        worldbookScan: {
          ...EMPTY_SCAN,
          depthEntries: [
            { content: '低优先(order5)', depth: 2, role: 'system', order: 5 },
            { content: '高优先(order10)', depth: 2, role: 'system', order: 10 },
          ],
        },
      }),
    );
    const idxLow = result.messages.findIndex((m) => m.content.startsWith('低优先'));
    const idxHigh = result.messages.findIndex((m) => m.content.startsWith('高优先'));
    expect(idxLow).toBeGreaterThan(0);
    expect(idxHigh).toBe(idxLow + 1); // 高 order 紧随低 order 之后、更接近最新消息
    // 两者都插在倒数第 2 条（h2）之前
    expect(result.messages[idxHigh + 1].content).toBe('h2');
  });

  it('同 depth 同 order 组内按 role system→user→assistant 处理（倒序 splice+reverse 后 system 最靠近最新消息）', () => {
    const result = assemblePrompt(
      makeCtx({
        history: makeHistory(['h1', 'h2', 'h3']),
        worldbookScan: {
          ...EMPTY_SCAN,
          depthEntries: [
            { content: '注入A(assistant)', depth: 1, role: 'assistant', order: 100 },
            { content: '注入U(user)', depth: 1, role: 'user', order: 100 },
            { content: '注入S(system)', depth: 1, role: 'system', order: 100 },
          ],
        },
      }),
    );
    // 酒馆 populationInjectionPrompts：roleMessages 按 system→user→assistant push 进
    // 倒序数组再 reverse → 正序组内为 assistant→user→system（system 优先级最高、贴近尾部）
    const idxA = result.messages.findIndex((m) => m.content === '注入A(assistant)');
    expect(idxA).toBeGreaterThan(0);
    expect(result.messages[idxA - 1].content).toBe('h2');
    expect(result.messages[idxA + 1].content).toBe('注入U(user)');
    expect(result.messages[idxA + 2].content).toBe('注入S(system)');
    expect(result.messages[idxA + 2].role).toBe('system');
    expect(result.messages[idxA + 3].content).toBe('h3');
  });

  it('作者注释按 noteDepth 注入（深度注入通道）', () => {
    const result = assemblePrompt(
      makeCtx({
        history: makeHistory(['h1', 'h2', 'h3']),
        workSettings: { ...defaultNovelSettings, authorNote: '保持轻松基调', noteDepth: 2 },
      }),
    );
    const idxAn = result.messages.findIndex((m) => m.content === '保持轻松基调');
    expect(idxAn).toBeGreaterThan(0);
    // depth=2：倒数第 2 条之前 → h1 之后、h2 之前
    expect(result.messages[idxAn - 1].content).toBe('h1');
    expect(result.messages[idxAn + 1].content).toBe('h2');
  });

  it('卡 depth_prompt 走深度注入通道（depth 缺省 4、role 缺省 system）', () => {
    const result = assemblePrompt(
      makeCtx({
        history: makeHistory(['h1', 'h2', 'h3']),
        cards: [
          makeCard({
            description: '卡描述',
            extensions: { depth_prompt: { prompt: '卡深度提示', depth: undefined, role: undefined } },
          }),
        ],
      }),
    );
    const idx = result.messages.findIndex((m) => m.content === '卡深度提示');
    expect(idx).toBeGreaterThan(0);
    // depth=4 超出历史长度：splice 语义落在最旧之前（酒馆一致）→ 插在 head 之后、h1 之前
    expect(result.messages[idx - 1].content.startsWith('【作品设定】')).toBe(true); // head 末块
    expect(result.messages[idx + 1].content).toBe('h1');
  });
});

// ---------- 预算与模式注入 ----------

describe('assemblePrompt 预算截断', () => {
  it('历史超预算从最旧截断，usage.truncated=true 且保留最新', () => {
    // 每条约 60 汉字 ≈ 90 token；5 条 ≈ 450 token，预算 300 只装 3 条左右
    const long = (n: number) => `第${n}章内容${'春秋冬夏日月山河林'.repeat(7).slice(0, 60)}`;
    const result = assemblePrompt(
      makeCtx({ history: makeHistory([long(1), long(2), long(3), long(4), long(5)]), budgetTokens: 300 }),
    );
    expect(result.usage.truncated).toBe(true);
    const contents = result.messages.map((m) => m.content);
    expect(contents.some((c) => c.startsWith('第5章内容'))).toBe(true); // 最新保留
    expect(contents.some((c) => c.startsWith('第1章内容'))).toBe(false); // 最旧裁掉
    expect(result.usage.promptTokens).toBeLessThanOrEqual(300 + 150); // 静态块之外历史受控
  });
});

describe('assemblePrompt 模式末尾注入', () => {
  it('novel 模式 directive 追加为末尾 user 消息（剧情指引）', () => {
    const result = assemblePrompt(makeCtx({ directive: '主角进入遗迹探险' }));
    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('剧情指引');
    expect(last.content).toContain('主角进入遗迹探险');
  });

  it('chat 模式 userMessage 追加为末尾 user 消息', () => {
    const result = assemblePrompt(makeCtx({ userMessage: '你好呀' }));
    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toBe('你好呀');
  });

  it('novel 模式 directive 与写作要求合并为同一条末尾 user 消息', () => {
    const result = assemblePrompt(
      makeCtx({ directive: '主角进入遗迹探险', chapterRequirement: '【本章写作要求】\n- 本章正文不少于 3000 字' }),
    );
    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('剧情指引：主角进入遗迹探险');
    expect(last.content).toContain('【本章写作要求】');
    expect(last.content).toContain('不少于 3000 字');
    // 全局只有一条注入消息同时承载两者（合并不拆分）
    expect(result.messages.filter((m) => m.content.includes('剧情指引'))).toHaveLength(1);
  });

  it('空指令连写时写作要求仍独立产出末尾 user 消息（连写后续章的关键回归）', () => {
    const result = assemblePrompt(
      makeCtx({ chapterRequirement: '【本章写作要求】\n- 本章正文不少于 3000 字' }),
    );
    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('【本章写作要求】');
    expect(last.content).not.toContain('剧情指引');
  });

  it('宏全局替换：世界书内容中的 {{char}}/{{user}} 被替换', () => {
    const result = assemblePrompt(
      makeCtx({
        worldbookScan: { ...EMPTY_SCAN, before: ['{{char}}凝视着{{user}}'], after: [] },
      }),
    );
    const wi = result.messages.find((m) => m.content.includes('凝视着'));
    expect(wi?.content).toBe('爱丽丝凝视着阿明');
    expect(result.messages.some((m) => m.content.includes('{{'))).toBe(false);
  });
});
