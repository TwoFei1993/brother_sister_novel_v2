/**
 * 生成流纯函数测试（useGenerate 的可测内核，§9.1 重试 / §9.2 继续语义 / §4.2 消息构造）
 */
import { describe, expect, it } from 'vitest';

import { aiVersion, type Message } from '@shared/message';

import {
  MAX_SWIPES,
  appendSwipe,
  buildChapterMessage,
  buildContinueDirective,
  historyBeforeTarget,
  nextChapterIndex,
  shouldRetry,
  swipeLimitError,
  toGenerationError,
} from '../generation-flow';

describe('shouldRetry（§9.1 网络类重试 ≤2 次，仅未产出内容时）', () => {
  it('网络错（LLM_NET）+ 0 chunk + 首次 → 重试', () => {
    expect(shouldRetry({ code: 'LLM_NET', message: 'net' }, 0, 0)).toBe(true);
  });

  it('超时（LLM_TIMEOUT）+ 0 chunk + 首次重试 → 再试一次', () => {
    expect(shouldRetry({ code: 'LLM_TIMEOUT', message: 'timeout' }, 0, 1)).toBe(true);
  });

  it('网络错 + 已产出 chunk → 不重试（走 partialKept「继续」路径）', () => {
    expect(shouldRetry({ code: 'LLM_NET', message: 'net' }, 5, 0)).toBe(false);
  });

  it('鉴权错（LLM_AUTH）→ 不重试', () => {
    expect(shouldRetry({ code: 'LLM_AUTH', message: 'bad key' }, 0, 0)).toBe(false);
  });

  it('额度错（LLM_QUOTA）→ 不重试', () => {
    expect(shouldRetry({ code: 'LLM_QUOTA', message: '429' }, 0, 0)).toBe(false);
  });

  it('内容被拒（LLM_REJECTED）→ 不重试', () => {
    expect(shouldRetry({ code: 'LLM_REJECTED', message: '拒' }, 0, 0)).toBe(false);
  });

  it('第 3 次失败（attempt=2，重试额度已尽）→ 不再重试', () => {
    expect(shouldRetry({ code: 'LLM_NET', message: 'net' }, 0, 2)).toBe(false);
  });

  it('客户端无法连接服务器（network）→ 重试', () => {
    expect(shouldRetry({ code: 'network', message: 'offline' }, 0, 0)).toBe(true);
  });

  it('静默断流（streamIncomplete）+ 0 chunk → 重试（review #1）', () => {
    expect(shouldRetry({ code: 'streamIncomplete', message: '流中断' }, 0, 0)).toBe(true);
  });

  it('静默断流但已产出半成品 → 不重试（走「继续」路径）', () => {
    expect(shouldRetry({ code: 'streamIncomplete', message: '流中断' }, 3, 0)).toBe(false);
  });
});

describe('buildContinueDirective（§9.2 继续语义）', () => {
  it('携带续写指令与 partial 尾部内容', () => {
    const d = buildContinueDirective('他推开门，看见了她。');
    expect(d).toContain('接着写完这一章');
    expect(d).toContain('他推开门，看见了她。');
  });

  it('超长 partial 只取尾部 200 字', () => {
    const partial = '前'.repeat(500) + '尾'.repeat(200);
    const d = buildContinueDirective(partial);
    expect(d).toContain('尾'.repeat(200));
    expect(d).not.toContain('前'.repeat(201));
  });
});

describe('nextChapterIndex', () => {
  it('无章节消息 → 1', () => {
    expect(nextChapterIndex([])).toBe(1);
  });

  it('取现有最大章号 + 1', () => {
    const messages = [
      { id: 'a', chapter: { index: 1, title: '一' } },
      { id: 'b', chapter: { index: 3, title: '三' } },
    ] as unknown as Message[];
    expect(nextChapterIndex(messages)).toBe(4);
  });
});

function baseMessage(partial: Partial<Message>): Message {
  return {
    id: 'm1',
    role: 'assistant',
    name: '小说家',
    content: '',
    createdAt: 0,
    swipes: [aiVersion('', 'v1', 0)],
    swipeId: 0,
    extra: {},
    ...partial,
  };
}

describe('buildChapterMessage（§4.2 消息模型）', () => {
  it('构造 assistant 消息：swipes=[content]、chapter、directive、extra 审计', () => {
    const msg = buildChapterMessage({
      content: '正文',
      title: '第一章 开端',
      chapterIndex: 1,
      directive: '写一个开场',
      model: 'gpt-4o',
      promptTokens: 1234,
      generationMs: 5678,
      statusSnapshot: { 灵力: 10 },
      activatedEntries: ['wb1:2'],
    });
    expect(msg).toMatchObject({
      role: 'assistant',
      name: '小说家',
      content: '正文',
      swipes: [{ name: 'v1', content: '正文', origin: 'ai' }],
      swipeId: 0,
      chapter: { index: 1, title: '第一章 开端' },
      directive: '写一个开场',
    });
    expect(msg.id).toBeTruthy();
    expect(msg.extra).toMatchObject({
      model: 'gpt-4o',
      tokenCount: 1234,
      generationMs: 5678,
      statusSnapshot: { 灵力: 10 },
      activatedEntries: ['wb1:2'],
    });
  });

  it('statusSnapshot/activatedEntries 缺省时不写入 extra', () => {
    const msg = buildChapterMessage({
      content: '正文',
      title: 't',
      chapterIndex: 2,
      promptTokens: 1,
      generationMs: 1,
    });
    expect(msg.extra.statusSnapshot).toBeUndefined();
    expect(msg.extra.activatedEntries).toBeUndefined();
  });
});

describe('appendSwipe（swipe 重生成：push 候选并切换）', () => {
  it('在既有 swipes 末尾追加并指向新候选，保留 id/chapter/directive', () => {
    const target = baseMessage({
      id: 'm9',
      content: '旧版本',
      swipes: [aiVersion('旧版本', 'v1', 0)],
      swipeId: 0,
      chapter: { index: 2, title: '二' },
      directive: '写第二章',
    });
    const next = appendSwipe(target, '新版本', { model: 'gpt-4o', tokenCount: 9, generationMs: 9 });
    expect(next.id).toBe('m9');
    expect(next.swipes.map((v) => ({ name: v.name, content: v.content }))).toEqual([
      { name: 'v1', content: '旧版本' },
      { name: 'v2', content: '新版本' },
    ]);
    expect(next.swipeId).toBe(1);
    expect(next.content).toBe('新版本');
    expect(next.chapter).toEqual({ index: 2, title: '二' });
    expect(next.directive).toBe('写第二章');
  });
});

describe('swipe 上限（review #13）', () => {
  it('MAX_SWIPES=50；swipeLimitError 携带 code 与含上限的人话消息', () => {
    expect(MAX_SWIPES).toBe(50);
    const ge = swipeLimitError();
    expect(ge.code).toBe('SWIPE_LIMIT');
    expect(ge.message).toContain('50');
  });
});

describe('historyBeforeTarget（review #10：重 roll 上下文取 target 之前）', () => {
  const list = [
    baseMessage({ id: 'u1', role: 'user', name: '用户', content: '开头' }),
    baseMessage({ id: 'a1', content: '旧候选章节', swipes: [aiVersion('旧候选章节', 'v1', 0)], swipeId: 0 }),
    baseMessage({ id: 'u2', role: 'user', name: '用户', content: '后续' }),
  ];

  it('截取 target 之前的消息（旧候选与其后消息都不进上下文）', () => {
    const history = historyBeforeTarget(list, 'a1');
    expect(history.map((m) => m.id)).toEqual(['u1']);
  });

  it('target 不在列表（窗口外/已刷新）→ 全量兜底', () => {
    expect(historyBeforeTarget(list, 'missing')).toEqual(list);
  });
});

describe('toGenerationError', () => {
  it('流 error 帧（{code,message}）原样转义', () => {
    expect(toGenerationError({ code: 'LLM_QUOTA', message: '额度' })).toEqual({
      code: 'LLM_QUOTA',
      message: '额度',
    });
  });

  it('AbortError → code=aborted（用户停止，非错误）', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    const ge = toGenerationError(err);
    expect(ge.code).toBe('aborted');
  });

  it('普通 Error → unknown + 原始消息', () => {
    expect(toGenerationError(new Error('boom'))).toEqual({ code: 'unknown', message: 'boom' });
  });
});
