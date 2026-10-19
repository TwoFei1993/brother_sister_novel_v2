// 三通道协议转换器测试：openai 直传、claude system 提取/合并/prefill、gemini systemInstruction/contents。
// 对照酒馆参考 SillyTavern src/prompt-converters.js 的 convertClaudeMessages / convertGooglePrompt 行为。
import { describe, expect, it } from 'vitest';

import { convert, toClaude, toGemini, toOpenAI } from '../../converters';
import type { ChatMessage } from '../../converters';

const msg = (role: ChatMessage['role'], content: string, name?: string): ChatMessage =>
  name === undefined ? { role, content } : { role, content, name };

describe('toOpenAI', () => {
  it('直传消息且保留 name 字段（openai 原生支持 name）', () => {
    const body = toOpenAI(
      [msg('system', '设定'), msg('user', '你好', '阿明'), msg('assistant', '嗯')],
      {},
    );
    expect(body.messages).toEqual([
      { role: 'system', content: '设定' },
      { role: 'user', name: '阿明', content: '你好' },
      { role: 'assistant', content: '嗯' },
    ]);
  });

  it('采样参数映射：temperature/top_p/max_tokens 透传', () => {
    const body = toOpenAI([msg('user', '嗨')], { temperature: 0.7, top_p: 0.9, max_tokens: 1024 });
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.max_tokens).toBe(1024);
  });

  it('参数缺省时不产生 undefined 字段，system 位置不限原样保留', () => {
    const body = toOpenAI(
      [msg('user', '前'), msg('system', '中途设定'), msg('user', '后')],
      {},
    );
    expect(JSON.stringify(body)).not.toContain('undefined');
    expect(body.messages[1]).toEqual({ role: 'system', content: '中途设定' });
  });

  it('空 messages 抛错', () => {
    expect(() => toOpenAI([], {})).toThrow('messages 不能为空');
  });
});

describe('toClaude', () => {
  it('头部连续 system 提取到 system[]，且只取头部连续段', () => {
    const body = toClaude(
      [msg('system', 'A'), msg('system', 'B'), msg('user', '问'), msg('system', 'C')],
      {},
    );
    expect(body.system).toBe('A\n\nB');
    // 中部 system 已转为 user 保留在 messages（下一用例细查）
    expect(body.messages.some((m) => m.content.includes('C'))).toBe(true);
  });

  it('中部/尾部 system 转为 user 保留在 messages', () => {
    const body = toClaude(
      [msg('system', '头'), msg('user', '问'), msg('system', '中'), msg('system', '尾')],
      {},
    );
    expect(body.system).toBe('头');
    // 「问」与降级后的「中」「尾」同为 user，按连续同 role 规则合并为一条（对齐酒馆）
    expect(body.messages).toEqual([{ role: 'user', content: '问\n\n中\n\n尾' }]);
  });

  it('末尾 assistant 作为 assistant-prefill 保留在末尾', () => {
    const body = toClaude([msg('user', '写首诗'), msg('assistant', '月光')], {});
    expect(body.messages).toEqual([
      { role: 'user', content: '写首诗' },
      { role: 'assistant', content: '月光' },
    ]);
  });

  it('连续同 role 以 \\n\\n 合并，且各自 name 前缀保留', () => {
    const body = toClaude(
      [msg('user', '你好', '阿明'), msg('user', '在吗'), msg('assistant', '在', '小雪'), msg('assistant', '怎么了')],
      {},
    );
    expect(body.messages).toEqual([
      { role: 'user', content: '阿明: 你好\n\n在吗' },
      { role: 'assistant', content: '小雪: 在\n\n怎么了' },
    ]);
  });

  it('max_tokens 必填：缺省 4096，params.max_tokens 优先', () => {
    expect(toClaude([msg('user', '问')], {}).max_tokens).toBe(4096);
    expect(toClaude([msg('user', '问')], { max_tokens: 2048 }).max_tokens).toBe(2048);
  });

  it('name 合并为 content 前缀（claude 无 name 字段）', () => {
    const body = toClaude([msg('user', '内容', '阿明'), msg('assistant', '回应', '小雪')], {});
    expect(body.messages).toEqual([
      { role: 'user', content: '阿明: 内容' },
      { role: 'assistant', content: '小雪: 回应' },
    ]);
  });

  it('空 messages 抛错', () => {
    expect(() => toClaude([], {})).toThrow('messages 不能为空');
  });
});

describe('toGemini', () => {
  it('全部 system 消息（含中部）抽出合并进 systemInstruction.parts', () => {
    const body = toGemini(
      [msg('system', 'A'), msg('user', '问'), msg('system', 'B'), msg('assistant', '答')],
      {},
    );
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'A' }, { text: 'B' }] });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: '问' }] },
      { role: 'model', parts: [{ text: '答' }] },
    ]);
  });

  it('角色映射：user→user、assistant→model', () => {
    const body = toGemini([msg('user', '问'), msg('assistant', '答'), msg('user', '再问')], {});
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('连续同 role 以 \\n\\n 合并', () => {
    const body = toGemini([msg('user', '一'), msg('user', '二'), msg('assistant', '三'), msg('assistant', '四')], {});
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: '一\n\n二' }] },
      { role: 'model', parts: [{ text: '三\n\n四' }] },
    ]);
  });

  it('generationConfig 映射：temperature/topP/maxOutputTokens', () => {
    const body = toGemini([msg('user', '问')], { temperature: 0.5, top_p: 0.95, max_tokens: 2048 });
    expect(body.generationConfig).toEqual({ temperature: 0.5, topP: 0.95, maxOutputTokens: 2048 });
  });

  it('name 合并进 content 前缀；空 messages 抛错', () => {
    const body = toGemini([msg('user', '你好', '阿明'), msg('assistant', '嗨', '小雪')], {});
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: '阿明: 你好' }] },
      { role: 'model', parts: [{ text: '小雪: 嗨' }] },
    ]);
    expect(() => toGemini([], {})).toThrow('messages 不能为空');
  });
});

describe('convert 分发', () => {
  it('按 source 分发到对应转换器', () => {
    const messages = [msg('system', 'S'), msg('user', 'U')];
    expect(convert('openai', messages, {})).toEqual(toOpenAI(messages, {}));
    expect(convert('claude', messages, {})).toEqual(toClaude(messages, {}));
    expect(convert('gemini', messages, {})).toEqual(toGemini(messages, {}));
  });

  it('未知 source 抛错', () => {
    expect(() => convert('mistral' as never, [msg('user', '问')], {})).toThrow('未知的 LLM 通道');
  });
});
