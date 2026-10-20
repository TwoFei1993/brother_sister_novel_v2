/**
 * 智能抽取 LLM 兜底测试：提示词约束（定界符 / 不创作） / 健壮 JSON 解析
 * （围栏剥离 / 前后杂文 / 花括号截取 / 失败 null） / 兜底启发式三分支 /
 * 空文档拒绝 / LLM→既有结构映射
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCharacterSheetPrompt,
  buildOutlinePrompt,
  countSuspectEntryHeads,
  estimateTokenKilo,
  llmExtract,
  outlineFromLlm,
  parseJsonLoose,
  shouldFallbackToLLM,
  sheetEntriesFromLlm,
} from '../llm-extract';
import type { LlmPrefs } from '../../stores/settings';

const PREFS: LlmPrefs = { source: 'claude', model: 'MiniMax-M3' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('提示词构建', () => {
  it('展板 prompt：system 与 user 均含「不创作不改写」约束，user 用定界符包裹原文并给出 JSON 字段', () => {
    const text = '01. 沈清晏｜镇国公府嫡长女\n18岁，性子沉静。';
    const { system, user } = buildCharacterSheetPrompt(text);
    expect(system).toContain('不创作');
    expect(system).toContain('不改写');
    expect(user).toContain('不创作、不改写');
    expect(user).toContain('<<<文档>>>');
    expect(user).toContain(text);
    expect(user).toContain('"characters"');
    expect(user).toContain('"description"');
    expect(user).toContain('模板');
  });

  it('大纲 prompt：定界符包裹原文，覆盖 characters/background/factions/conflict 四类字段', () => {
    const text = '一、故事背景：灵气复苏的大周王朝…';
    const { system, user } = buildOutlinePrompt(text);
    expect(system).toContain('只做信息抽取');
    expect(user).toContain('<<<文档>>>');
    expect(user).toContain(text);
    expect(user).toContain('"background"');
    expect(user).toContain('"factions"');
    expect(user).toContain('"conflict"');
    expect(user).toContain('"personality"');
  });
});

describe('parseJsonLoose 健壮 JSON 解析', () => {
  it('剥 ```json 围栏', () => {
    const raw = '```json\n{"characters":[{"name":"张三"}]}\n```';
    const parsed = parseJsonLoose<{ characters: [{ name: string }] }>(raw);
    expect(parsed?.characters[0]?.name).toBe('张三');
  });

  it('剥前后杂文：截取首个 { 到最后一个 }', () => {
    const raw = '好的，以下是解析结果：\n{"characters":[{"name":"李四"}],"background":"大周"}\n希望有帮助。';
    const parsed = parseJsonLoose<{ characters?: [{ name: string }]; background?: string }>(raw);
    expect(parsed?.characters?.[0]?.name).toBe('李四');
    expect(parsed?.background).toBe('大周');
  });

  it('围栏截断（缺闭合 ```）仍可截取花括号解析', () => {
    const raw = '```json\n{"characters":[{"name":"王五"}]}';
    const parsed = parseJsonLoose<{ characters: [{ name: string }] }>(raw);
    expect(parsed?.characters[0]?.name).toBe('王五');
  });

  it('非法 JSON / 缺右括号的截断 JSON / 无花括号 → 返回 null', () => {
    expect(parseJsonLoose('{"characters":[{"name":"张三"}')).toBeNull(); // 截断
    expect(parseJsonLoose('这不是 JSON')).toBeNull();
    expect(parseJsonLoose('')).toBeNull();
  });
});

describe('llmExtract LLM 非流式抽取', () => {
  it('空文档直接拒绝，不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await llmExtract('   ', buildOutlinePrompt('x'), PREFS);
    expect(out.parsed).toBeNull();
    expect(out.raw).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /api/llm/generate（stream:false, temperature 0.2, max_tokens 4000），围栏 JSON 可解析', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ text: '```json\n{"characters":[{"name":"赵六","personality":"冷峻寡言，剑法超群"}]}\n```' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await llmExtract('一段大纲', buildOutlinePrompt('一段大纲'), PREFS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/llm/generate');
    const body = JSON.parse(String(init.body)) as {
      stream: boolean;
      params: { temperature: number; max_tokens: number };
      messages: { role: string }[];
    };
    expect(body.stream).toBe(false);
    expect(body.params.temperature).toBe(0.2);
    expect(body.params.max_tokens).toBe(4000);
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    const outline = outlineFromLlm(out.parsed);
    expect(outline?.characters[0]?.name).toBe('赵六');
  });
});

describe('shouldFallbackToLLM 兜底启发式三分支', () => {
  it('规则 0 条目且文本 >500 字 → 兜底', () => {
    expect(shouldFallbackToLLM(0, 600)).toBe(true);
  });

  it('展板路径：条目 <3 且疑似条目头 ≥3 → 兜底', () => {
    expect(shouldFallbackToLLM(2, 800, 4)).toBe(true);
    expect(shouldFallbackToLLM(0, 300, 3)).toBe(true);
  });

  it('规则成功（≥3 条）或文本过短 → 不兜底', () => {
    expect(shouldFallbackToLLM(3, 600, 0)).toBe(false);
    expect(shouldFallbackToLLM(0, 300, 0)).toBe(false);
    expect(shouldFallbackToLLM(5, 1200, 6)).toBe(false);
  });
});

describe('countSuspectEntryHeads 疑似展板条目头', () => {
  it('序号 + 分隔符 + 行内含「｜」的行计入；普通大纲序号行不计入', () => {
    const sheetLike = ['01. 甲｜身份一', '2) 乙 | 身份二', '三、丙｜身份三', '描述正文'].join('\n');
    expect(countSuspectEntryHeads(sheetLike)).toBe(3);
    const outlineLike = ['一、故事背景：灵气复苏', '二、主要人物：林昭', '三、核心矛盾：夺嫡'].join('\n');
    expect(countSuspectEntryHeads(outlineLike)).toBe(0);
  });
});

describe('LLM 结果映射', () => {
  it('sheetEntriesFromLlm：缺字段兜底空串、age 数字化、无名条目跳过、非数组防御', () => {
    const entries = sheetEntriesFromLlm({
      characters: [
        { name: '沈清晏', identity: '嫡长女', description: '18岁，沉静。', age: 18 },
        { name: '  ' },
        { description: '无名条目' },
        { name: '墨千秋', identity: '', group: '听雨楼', description: '' },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ name: '沈清晏', identity: '嫡长女', group: '', description: '18岁，沉静。', age: 18 });
    expect(entries[1]?.group).toBe('听雨楼');
    expect(entries[1]?.age).toBeUndefined();
    expect(sheetEntriesFromLlm(null)).toEqual([]);
    expect(sheetEntriesFromLlm({ characters: 'x' })).toEqual([]);
  });

  it('outlineFromLlm：personality 切特质、factions 整体一条、全空返回 null', () => {
    const outline = outlineFromLlm({
      characters: [{ name: '林昭', role: '哥哥', personality: '沉稳内敛、天赋异禀；护妹成魔' }],
      background: '灵气复苏的大周王朝',
      factions: '北境镇国公府；南疆巫教',
      conflict: '皇权与仙门的暗斗',
    });
    expect(outline?.characters[0]?.traits).toEqual(['沉稳内敛', '天赋异禀', '护妹成魔']);
    expect(outline?.factions).toEqual(['北境镇国公府；南疆巫教']);
    expect(outline?.background).toBe('灵气复苏的大周王朝');
    expect(outlineFromLlm({ characters: [], background: '', factions: '', conflict: '' })).toBeNull();
    expect(outlineFromLlm('not-object')).toBeNull();
  });
});

describe('estimateTokenKilo token 粗估', () => {
  it('按千字向上取整，最小 1', () => {
    expect(estimateTokenKilo(600)).toBe(1);
    expect(estimateTokenKilo(2600)).toBe(3);
    expect(estimateTokenKilo(0)).toBe(1);
  });
});

describe('shouldFallbackToLLM 背景判定（真实用户 docx 实测反馈）', () => {
  it('有人物但背景缺失的长文档 → 触发兜底（2 行巨段 docx 案例）', async () => {
    const { shouldFallbackToLLM } = await import('../llm-extract');
    expect(shouldFallbackToLLM(1, 16378, 0, false)).toBe(true); // 规则只抽到 1 人、无背景
  });

  it('人物与背景齐备 → 不触发', async () => {
    const { shouldFallbackToLLM } = await import('../llm-extract');
    expect(shouldFallbackToLLM(3, 2000, 0, true)).toBe(false);
  });
});
