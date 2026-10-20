/**
 * 用户 docx 实测失败回归（反馈③追问）：MiniMax 长字符串值内部夹裸换行导致
 * JSON.parse 抛「Bad control character」，直接解析与 LLM 修复重试双双失败。
 * 修复：parseJsonLoose 二次尝试——字符串内裸控制字符转义后重解析。
 * 另：模型字段别名（role/personality）映射兼容。
 */
import { describe, expect, it } from 'vitest';

import { parseJsonLoose, sheetEntriesFromLlm } from '../outline/llm';

describe('parseJsonLoose 字符串内裸控制字符修复（用户 docx 实测失败样本）', () => {
  it('长字符串值内部的裸换行 → 二次修复解析成功', () => {
    // 模拟 MiniMax pretty-print 时把换行落在字符串值内部（JSON.parse 必抛）
    const raw = '{"characters":[{"name":"沈清晏","identity":"女主","description":"第一行描述\n第二行描述"}]}';
    const r = parseJsonLoose<{ characters: { name: string; description: string }[] }>(raw);
    expect(r).not.toBeNull();
    expect(r!.characters[0].description).toBe('第一行描述\n第二行描述');
  });

  it('字符串内制表符同样修复', () => {
    expect(parseJsonLoose<{ background: string }>('{"background":"列\t项\t值"}')?.background).toBe('列\t项\t值');
  });

  it('已合法的 JSON 不受影响', () => {
    expect(parseJsonLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('sheetEntriesFromLlm 字段别名兼容（用户 docx 实测 role/personality 错位）', () => {
  it('role → identity、personality → description 别名映射', () => {
    const parsed = {
      characters: [
        { name: '沈清晏', role: '女主/镇国公府嫡长女', personality: '胎穿INFJ人格，极致未雨绸缪' },
      ],
    };
    const list = sheetEntriesFromLlm(parsed);
    expect(list).toHaveLength(1);
    expect(list[0].identity).toBe('女主/镇国公府嫡长女');
    expect(list[0].description).toBe('胎穿INFJ人格，极致未雨绸缪');
  });
});
