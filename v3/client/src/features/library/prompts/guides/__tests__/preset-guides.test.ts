/**
 * 提示词中文简介层测试：通用 identifier 优先 / 名称关键词规则 / Sudachi 识别。
 */
import { describe, expect, it } from 'vitest';

import {
  describePrompt, describePromptByName, isSudachiPreset, PROMPT_MARKDOWN_DESC, SUDACHI_GUIDE,
} from '../preset-guides';

describe('describePrompt', () => {
  it('通用 identifier 优先于名称关键词', () => {
    // identifier=main 命中通用说明，即使名称含「文风」等关键词
    expect(describePrompt('main', '文风设定')).toBe(PROMPT_MARKDOWN_DESC.main);
    expect(describePrompt('chatHistory', '任意名')).toBe('聊天历史占位');
    expect(describePrompt('jailbreak', 'x')).toContain('越狱层');
    expect(describePrompt('worldInfoBefore', 'x')).toContain('角色定义前');
  });

  it('名称关键词规则：单选组 / COT / 反XX / 文风与 人称选项', () => {
    expect(describePromptByName('文风设定')).toContain('文风单选组');
    expect(describePromptByName('人称设定')).toContain('人称单选组');
    expect(describePromptByName('COT始')).toContain('思维链');
    expect(describePromptByName('cot-末')).toContain('思维链'); // 大小写不敏感
    expect(describePromptByName('操作区')).toContain('预留操作位');
    expect(describePromptByName('变量初始化')).toContain('保持启用');
    expect(describePromptByName('聊天历史符')).toContain('定界符');
    expect(describePromptByName('备用Role')).toContain('备用角色');
    expect(describePromptByName('反重复')).toContain('对抗性规则');
    expect(describePromptByName('轻小说风')).toBe('文风选项（单选组之一）');
    expect(describePromptByName('第三人称')).toBe('人称选项（单选组之一）');
  });

  it('未命中返回 null（行内不显示简介）', () => {
    expect(describePrompt('custom-xyz', '完全无关的名称')).toBeNull();
  });
});

describe('isSudachiPreset / SUDACHI_GUIDE', () => {
  it('Sudachi 系识别与分组说明完整性', () => {
    expect(isSudachiPreset('Sudachi-Next 正式版')).toBe(true);
    expect(isSudachiPreset('默认预设')).toBe(false);
    const titles = SUDACHI_GUIDE.map((g) => g.title);
    expect(titles).toEqual(['主提示词', 'COT', '文风单选组', '人称单选组', '附加选项多选', '操作区']);
  });
});
