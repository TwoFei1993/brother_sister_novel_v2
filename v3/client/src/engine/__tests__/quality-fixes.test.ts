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

describe('提纲分离 splitOutline', () => {
  it('分离带标记词的要点提纲（列表式）', async () => {
    const { splitOutline } = await import('../prompt/postprocess');
    const content = '**本章要点**\n- 林枫在便利店发现异响\n- 神秘店员现身\n- 结尾留下悬念\n\n天蒙蒙亮的时候，林枫被一阵急促的脚步声惊醒。他几乎是本能地从床上弹起。';
    const r = splitOutline(content);
    expect(r.outline).toContain('本章要点');
    expect(r.body).toBe('天蒙蒙亮的时候，林枫被一阵急促的脚步声惊醒。他几乎是本能地从床上弹起。');
  });

  it('分离编号式提纲（含引导行「剧情走向：」）', async () => {
    const { splitOutline } = await import('../prompt/postprocess');
    const content = '剧情走向：\n1. 开篇雨夜\n2. 追兵现身\n\n雨点砸在窗棂上，她攥紧了那半块玉佩。';
    const r = splitOutline(content);
    expect(r.outline).toContain('剧情走向');
    expect(r.body.startsWith('雨点砸在窗棂上')).toBe(true);
  });

  it('无提纲标记时原样返回（正文以列表开头不算提纲）', async () => {
    const { splitOutline } = await import('../prompt/postprocess');
    const content = '- 第一天\n- 第二天\n这样的日子持续了很久，直到那个人的出现改变了一切。';
    const r = splitOutline(content);
    expect(r.outline).toBeUndefined();
    expect(r.body).toBe(content);
  });
});

describe('防失忆：planContext 上下文规划', () => {
  it('预算充足时全量保留', async () => {
    const { planContext } = await import('../../hooks/generation-pipeline');
    const msgs = [1, 2, 3].map((i) => ({ id: `m${i}`, role: 'assistant' as const, name: '小说家', content: '短'.repeat(50), createdAt: i, swipes: ['短'.repeat(50)], swipeId: 0, extra: {} }));
    const r = planContext(msgs, 10000);
    expect(r.dropped).toHaveLength(0);
    expect(r.kept).toHaveLength(3);
  });

  it('超预算时从最旧侧切出待摘要区（保留最新）', async () => {
    const { planContext } = await import('../../hooks/generation-pipeline');
    const long = '字'.repeat(3000);
    const msgs = [1, 2, 3, 4].map((i) => ({ id: `m${i}`, role: 'assistant' as const, name: '小说家', content: long, createdAt: i, swipes: [long], swipeId: 0, extra: {} }));
    const r = planContext(msgs, 5000); // 每条约 4500 token，预算只装得下 1 条
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].id).toBe('m4');
    expect(r.dropped.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});
