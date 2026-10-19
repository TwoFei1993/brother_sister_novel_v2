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

  it('novel 兜底主提示词字数透传设置值（不再硬编码 1500）', () => {
    const p = buildFallbackPreset('directive', 'medium', 5000);
    const main = p.prompts.find((x) => x.identifier === 'main');
    expect(main?.content).toContain('每章正文不少于 5000 字');
    expect(main?.content).not.toContain('1500');
  });
});

describe('novel 写作要求注入（requirements）', () => {
  it('buildChapterRequirement 含字数下限与输出纪律', async () => {
    const { buildChapterRequirement } = await import('../prompt/requirements');
    const text = buildChapterRequirement(3000);
    expect(text).toContain('【本章写作要求】');
    expect(text).toContain('不少于 3000 字');
    expect(text).toContain('System');
    expect(text).toContain('禁止');
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

describe('无标签思维流剥离（质检T4 实测泄露形态）', () => {
  it('标记行优先：取「【正文】」之后的内容', async () => {
    const { stripLooseThinking } = await import('../prompt/postprocess');
    const raw = '让我先构思一下。\n\n场景设定：黄昏的学校。\n\n【正文】\n\n黄昏时分，我赶到了学校。「铃奈！」我推开了教导处的门。';
    expect(stripLooseThinking(raw)).toBe('黄昏时分，我赶到了学校。「铃奈！」我推开了教导处的门。');
  });

  it('无标记时按规划段落剥离（对照质检T4 用户粘贴样本形态）', async () => {
    const { stripLooseThinking } = await import('../prompt/postprocess');
    const raw = [
      '让我先理解一下当前的情况：',
      '',
      '场景回顾：上一轮剧情中，兄妹俩在老城区的面馆吃完饭，正准备去逛夜市。',
      '',
      '我需要构思如何自然地衔接这个剧情跳跃。',
      '',
      '写作风格：日系轻小说，以对话为主。',
      '',
      '黄昏时分，我赶到了学校，教导处的门在我面前显得格外沉重。「铃奈，是谁干的。」我的声音很平静，平静得连我自己都意外。',
    ].join('\n');
    const r = stripLooseThinking(raw);
    expect(r.startsWith('黄昏时分')).toBe(true);
    expect(r).not.toContain('场景回顾');
  });

  it('整段都是思考流时不剥离（防清空保护）', async () => {
    const { stripLooseThinking } = await import('../prompt/postprocess');
    const raw = '让我开始写正文。\n\n我需要确保对话占比 60%。\n\n字数要求：800-1200 字。\n\n多回复选项设计：4 个选项。';
    expect(stripLooseThinking(raw)).toBe(raw);
  });
});

describe('尾部元信息块剥离（质检T4 用户实地反馈形态）', () => {
  it('正文后的 A-D 选项块+剧情摘要整体截断', async () => {
    const { stripTailMeta, presentable } = await import('../prompt/postprocess');
    const raw = [
      '「哥，你盯着我看干嘛啦。」铃奈吸溜了一大口面条。',
      '「没什么，只是看你吃这么香。」我放下筷子笑了。',
      '车轮终于顺畅地转了起来，哥哥站起来拍了拍手上的油渍。',
      'A. 我牵起她的手：「走慢点，别摔了。」',
      'B. 我无奈叹气：「就知道乱花钱，钱包又要空了。」',
      'C. 我看向她的脸色：「今天脸色不错吗？」',
      'D. 我掏出钱结账，催促道：「快点，夜市一会就收摊了。」',
      '',
      '在老城区的街边老面馆，兄妹二人吃着晚饭，回忆起过去的艰难时光。',
    ].join('\n');
    const r = stripTailMeta(raw);
    expect(r).not.toContain('A. 我牵起她的手');
    expect(r).not.toContain('在老城区的街边老面馆');
    expect(r.startsWith('「哥，你盯着我看干嘛啦。」')).toBe(true);
    // presentable 组合链不受影响
    expect(presentable(raw)).not.toContain('B. 我无奈叹气');
  });

  it('首行「## 正文」标记头剥离', async () => {
    const { presentable } = await import('../prompt/postprocess');
    const raw = '## 正文\n\n随着老城区深秋傍晚的夕阳拉长，我夹起一筷子热气腾腾的碱面，送进嘴里。';
    expect(presentable(raw)).toBe('随着老城区深秋傍晚的夕阳拉长，我夹起一筷子热气腾腾的碱面，送进嘴里。');
  });

  it('前部选项形文本（位置阈值前）与单行选项不触发截断', async () => {
    const { stripTailMeta } = await import('../prompt/postprocess');
    // 选项形行位于全文前部（<40%），不在尾部元信息区
    const early = ['A. 开头第一行', 'B. 开头第二行', '叙述一。', '叙述二。', '叙述三。', '叙述四。'].join('\n');
    expect(stripTailMeta(early)).toBe(early);
    // 尾部仅单行选项形（不足 ≥2 行连续），不构成选项块
    const single = ['叙述一。', '叙述二。', '叙述三。', '叙述四。', '叙述五。', '附注：A. 备忘'].join('\n');
    expect(stripTailMeta(single)).toBe(single);
  });
});

describe('标签化元信息剥离（质检T4 实地检查形态）', () => {
  it('HTML 注释提示从正文中移除', async () => {
    const { presentable } = await import('../prompt/postprocess');
    const raw = '<!-- 1. 确立视角与场景基调 --> 随着夕阳拉长，我夹起一筷子碱面。<!-- 2. 对话为主 -->';
    expect(presentable(raw)).toBe('随着夕阳拉长，我夹起一筷子碱面。');
  });

  it('<reply> 选项块与 <S-summary> 摘要块整体移除（含未闭合）', async () => {
    const { presentable } = await import('../prompt/postprocess');
    const closed = '正文第一段。\n<reply>\nA. 选项一\nB. 选项二\n</reply>\n<S-summary>兄妹吃完面。</S-summary>';
    expect(presentable(closed)).toBe('正文第一段。');
    const unclosed = '正文第一段。\n<reply>\nA. 选项一\nB. 选项二';
    expect(presentable(unclosed)).toBe('正文第一段。');
  });
});

describe('chat 模式净化收尾（对话实测反馈）', () => {
  it('无冒号角色名前缀只剥一层（保留对白里的称呼）', async () => {
    const { sanitizeOutput } = await import('../prompt/postprocess');
    expect(sanitizeOutput('哥哥哥哥，你快看这个！', '哥哥')).toBe('哥哥，你快看这个！');
    expect(sanitizeOutput('妹妹，你没事吧。', '哥哥')).toBe('妹妹，你没事吧。');
    expect(sanitizeOutput('Seraphina 的森林很安静。', 'Seraphina')).toBe('Seraphina 的森林很安静。');
  });

  it('完整净化链：预设片段 <Aniplex> 与思维流在 presentable 中清除', async () => {
    const { presentable } = await import('../prompt/postprocess');
    const raw = '妹妹妹妹<Aniplex>只写角色行为语言</Aniplex>\n\n让我理清思路。用户扮演的是哥哥。\n\n「哥哥，你快看这个！」妹妹举起手中的模型。';
    const r = presentable(raw, '妹妹');
    expect(r).not.toContain('<Aniplex>');
    expect(r).not.toContain('让我理清思路');
    expect(r).toContain('你快看这个');
  });
});
