/**
 * 质量测试（docs/质量测试报告.md）发现的缺陷修复回归：
 * - 内置卫生层 sanitizeOutput：思考块/名字前缀/嵌套标题
 * - 兜底预设 buildFallbackPreset：novel/chat 双模式主提示词
 */
import { describe, expect, it } from 'vitest';

import { postprocessMessage, sanitizeOutput } from '../prompt/postprocess';
import { buildFallbackPreset } from '../../hooks/generation-pipeline';

describe('内置卫生层 sanitizeOutput', () => {
  it('剥离成对思考块（含 thinking 变体，大小写不敏感）', () => {
    const raw = '<thinking>先想一下</thinking>正文开始。';
    expect(sanitizeOutput(raw)).toBe('正文开始。');
    expect(sanitizeOutput('<THINK>abc</THINK>正文')).toBe('正文');
  });

  it('剥离流中断产生的未闭合思考块', () => {
    expect(sanitizeOutput('正文。<think>没写完就被截断')).toBe('正文。');
  });

  it('剥离正文开头的角色名前缀（自定义与内置名）', () => {
    expect(sanitizeOutput('Seraphina: 早上好。', 'Seraphina')).toBe('早上好。');
    expect(sanitizeOutput('小说家：第二章内容', '小说家')).toBe('第二章内容');
  });

  it('剥离首行之后的嵌套标题行（首行章节标题豁免，交给标题解析）', () => {
    const raw = '# 第一章 开端\n正文第一段。\n## 卷一 · 风起\n正文第二段。';
    expect(sanitizeOutput(raw)).toBe('# 第一章 开端\n正文第一段。\n正文第二段。');
  });
});

describe('兜底预设 buildFallbackPreset', () => {
  it('novel（directive）：主提示词为小说作家语义', () => {
    const p = buildFallbackPreset('directive');
    const main = p.prompts.find((x) => x.identifier === 'main');
    expect(main?.content).toContain('小说作家');
    expect(p.prompts.some((x) => x.identifier === 'jailbreak')).toBe(true);
    // marker 骨架保留（世界书装填位不丢）
    expect(p.prompt_order?.[0]?.order.some((o) => o.identifier === 'worldInfoBefore')).toBe(true);
  });

  it('chat（userMessage）：主提示词为角色扮演语义且含 {{char}} 宏', () => {
    const p = buildFallbackPreset('userMessage');
    const main = p.prompts.find((x) => x.identifier === 'main');
    expect(main?.content).toContain('{{char}}');
    expect(main?.content).not.toContain('小说作家');
  });
});

describe('postprocessMessage 集成卫生层', () => {
  it('思考块与名字前缀在完整管道中被剥离', () => {
    const r = postprocessMessage('<think>提纲</think>小说家：雨夜逃亡。', {
      speakerName: '小说家',
      directive: '开篇：雨夜逃亡',
    });
    expect(r.content).toBe('雨夜逃亡。');
  });
});
