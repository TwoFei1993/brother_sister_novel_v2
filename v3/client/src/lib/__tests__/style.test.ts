/**
 * 文风复刻测试：分析提示词约束 / 画像清洗 / 空输入拒绝 / LLM 调用形状
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MIN_SAMPLE_CHARS, analyzeStyle, buildStyleAnalysisPrompt, cleanStyleProfile } from '../style';
import type { LlmPrefs } from '../../stores/settings';

const PREFS: LlmPrefs = { source: 'claude', model: 'MiniMax-M3' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildStyleAnalysisPrompt 分析提示词', () => {
  it('system 与 user 均含「只提炼写法不复述内容」硬约束，且不提及情节人名', () => {
    const { system, user } = buildStyleAnalysisPrompt('样本文本');
    expect(system).toContain('只描述');
    expect(system).toContain('绝不复述');
    expect(user).toContain('只提炼写法，不复述内容');
    expect(user).toContain('不得提及原文的情节、人物名');
  });

  it('user 嵌入参考文字原文并用定界符隔离', () => {
    const sample = '他推门。风灌进来。桌上有一封信。'.repeat(6);
    const { user } = buildStyleAnalysisPrompt(sample);
    expect(user).toContain(sample);
    expect(user).toContain('<<<');
    expect(user).toContain('叙事人称与视角');
    expect(user).toContain('禁忌');
  });

  it('参考文字建议最小字数常量为 200', () => {
    expect(MIN_SAMPLE_CHARS).toBe(200);
  });
});

describe('cleanStyleProfile 画像清洗', () => {
  it('剥整段引号包裹', () => {
    expect(cleanStyleProfile('“1. 叙事人称：第三人称限制视角”')).toBe('1. 叙事人称：第三人称限制视角');
    expect(cleanStyleProfile('「1. 句式：短句为主」')).toBe('1. 句式：短句为主');
  });

  it('剥前言客套行与尾部收尾行', () => {
    const raw = '好的，以下是文风画像：\n1. 叙事人称：第一人称\n2. 句式节奏：长短交替\n希望对你有帮助';
    expect(cleanStyleProfile(raw)).toBe('1. 叙事人称：第一人称\n2. 句式节奏：长短交替');
  });

  it('剥代码栅栏包裹并保留正文首尾引号', () => {
    const raw = '```\n1. 视角：全知\n他说“走吧”。\n```';
    expect(cleanStyleProfile(raw)).toBe('1. 视角：全知\n他说“走吧”。');
  });
});

describe('analyzeStyle 文风分析', () => {
  it('空参考文字直接拒绝，不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzeStyle(PREFS, '   ')).rejects.toThrow('请先粘贴一段参考文字');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /api/llm/generate 非流式（stream:false），返回清洗后画像', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ text: '好的，以下是文风画像：\n1. 叙事人称：第三人称' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await analyzeStyle(PREFS, '他推门。风灌进来。');
    expect(out).toBe('1. 叙事人称：第三人称');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/llm/generate');
    const body = JSON.parse(String(init.body)) as { stream: boolean; source: string; model: string };
    expect(body.stream).toBe(false);
    expect(body.source).toBe('claude');
    expect(body.model).toBe('MiniMax-M3');
  });

  it('LLM 返回空白画像视为失败', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ text: '  ' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    await expect(analyzeStyle(PREFS, '样本')).rejects.toThrow('文风分析返回为空');
  });
});
