/**
 * chat 元信息残章测试（深度测试 D7 回归：chat 残章不再以角色名义入库）
 *
 * - finalizeChatGeneration 纯逻辑：meta-only 占位不入库（返回 metaOnly turn）/ 正常正文照常入库
 * - runChatWithMetaRetry 编排（run 注入）：首轮残章自动带守卫后缀重试一次；重试后仍残章 →
 *   返回 null + 错误进 store（「本轮只生成了思考内容，请重试」）；流中错误（null）不重试
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultNovelSettings, type Work } from '@shared/work';
import type { Message } from '@shared/message';

import { useGenerationStore } from '../../../stores/generation';
import { useSettingsStore } from '../../../stores/settings';
import {
  buildChatMacroEnv,
  finalizeChatGeneration,
  runChatWithMetaRetry,
  type ChatFinalizeInput,
  type ChatRunOptions,
  type ChatTurn,
} from '../chat-flow';

function chatWork(): Work {
  return {
    id: 'w1',
    revision: 1,
    title: '测试对话',
    mode: 'chat',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: defaultNovelSettings,
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

type FetchCall = { path: string; init: RequestInit };
let calls: FetchCall[] = [];

function stubMessagesPost(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
}

const SPEAKER = { id: 'c1', name: '哥哥' };

async function finalizeWith(buffer: string): Promise<{ turn: Awaited<ReturnType<typeof finalizeChatGeneration>>; posts: number }> {
  useGenerationStore.setState({ buffer });
  const input: ChatFinalizeInput = {
    work: chatWork(),
    userText: '晚上吃什么',
    speaker: SPEAKER,
    swipeTarget: null,
    assets: { preset: null, cards: [], worldbooks: [], regexScripts: [] },
    env: buildChatMacroEnv(chatWork(), SPEAKER, { work: new Map(), global: new Map() }),
    prefs: { source: 'openai', model: 'm3' },
    promptTokens: 100,
    activatedIds: [],
    startedAt: Date.now(),
    pending: { work: new Map(), global: new Map() },
  };
  const turn = await finalizeChatGeneration(input);
  const posts = calls.filter((c) => c.path === '/api/works/w1/messages').length;
  return { turn, posts };
}

/** 假 run：按脚本依次返回（绕开 hook+SSE 组合在并行 worker 下的环境死锁，直接测编排语义） */
function fakeRun(script: Array<ChatTurn | null>): {
  run: ReturnType<typeof vi.fn>;
  promise: (history: Message[], userText: string, speaker: typeof SPEAKER, opts: ChatRunOptions) => Promise<ChatTurn | null>;
} {
  let i = 0;
  const run = vi.fn(async () => {
    const out = script[Math.min(i, script.length - 1)] ?? null;
    i += 1;
    return out;
  }) as ReturnType<typeof vi.fn>;
  return {
    run,
    promise: (history, userText, speaker, opts) =>
      runChatWithMetaRetry(run as never, history, userText, speaker, opts),
  };
}

function metaOnlyTurn(): ChatTurn {
  return {
    user: null,
    assistant: { id: 'a1', role: 'assistant', name: '哥哥', content: '', createdAt: 1, swipes: [''], swipeId: 0, extra: {} },
    metaOnly: true,
  };
}

function okTurn(): ChatTurn {
  return {
    user: null,
    assistant: { id: 'a2', role: 'assistant', name: '哥哥', content: '哥哥点点头：「好啊，一起吃。」', createdAt: 1, swipes: ['x'], swipeId: 0, extra: {} },
  };
}

const OPTS: ChatRunOptions = { targetId: 't1', initialBuffer: '' };

describe('finalizeChatGeneration（D7：残章不以角色名义入库）', () => {
  beforeEach(() => {
    calls = [];
    useGenerationStore.getState().reset();
    useSettingsStore.getState().setLlmPrefs({ source: 'openai', model: 'm3' });
    stubMessagesPost();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('整轮只有思考 → metaOnly turn，零入库（不再产生角色名义占位消息）', async () => {
    const { turn, posts } = await finalizeWith('<thinking>让我想想今晚的剧情。</thinking>');
    expect(turn.metaOnly).toBe(true);
    expect(turn.user).toBeNull();
    expect(posts).toBe(0); // 占位不入库
  });

  it('正常对话正文 → 正常 turn，user+assistant 成对入库，入库 user 为干净文本', async () => {
    const { turn, posts } = await finalizeWith('今晚吃火锅，我来下菜。');
    expect(turn.metaOnly).toBeUndefined();
    expect(turn.assistant.content).toContain('火锅');
    expect(turn.assistant.name).toBe('哥哥');
    expect(posts).toBe(2); // user + assistant
    const storedUser = JSON.parse(String(calls[0]!.init.body)) as { content: string };
    expect(storedUser.content).toBe('晚上吃什么');
  });
});

describe('runChatWithMetaRetry（D7：残章自动重试一次）', () => {
  beforeEach(() => {
    useGenerationStore.getState().reset();
  });

  it('首轮残章 → 自动带守卫后缀重发一次（userText 参数保持干净文本），重试成功返回正常 turn', async () => {
    const { run, promise } = fakeRun([metaOnlyTurn(), okTurn()]);
    const turn = await promise([], '晚上吃什么', SPEAKER, OPTS);
    expect(run).toHaveBeenCalledTimes(2); // 恰好重试一次
    const secondCall = (run.mock.calls[1] as unknown[])![3] as ChatRunOptions;
    expect(secondCall.promptUserText).toContain('系统重试'); // 守卫后缀只进提示词通道
    expect(secondCall.promptUserText).toContain('晚上吃什么'); // 后缀拼接在原文本之后
    expect(turn).not.toBeNull();
    expect(turn!.assistant.content).toContain('一起吃');
    expect(useGenerationStore.getState().error).toBeNull(); // 成功路径无错误
  });

  it('重试后仍残章 → 返回 null + 错误进 store（「本轮只生成了思考内容，请重试」）', async () => {
    const { run, promise } = fakeRun([metaOnlyTurn(), metaOnlyTurn()]);
    const turn = await promise([], '晚上吃什么', SPEAKER, OPTS);
    expect(run).toHaveBeenCalledTimes(2); // 重试恰好一次
    expect(turn).toBeNull(); // 残章不入库、不返回占位
    const err = useGenerationStore.getState().error;
    expect(err?.message).toContain('本轮只生成了思考内容，请重试');
  });

  it('首轮即返回 null（流中错误/停止）→ 不算残章，原样返回不重试', async () => {
    const { run, promise } = fakeRun([null]);
    const turn = await promise([], '晚上吃什么', SPEAKER, OPTS);
    expect(run).toHaveBeenCalledTimes(1); // 绝不重试
    expect(turn).toBeNull();
    expect(useGenerationStore.getState().error).toBeNull();
  });

  it('首轮即正常正文 → 单次调用不重试', async () => {
    const { run, promise } = fakeRun([okTurn()]);
    const turn = await promise([], '晚上吃什么', SPEAKER, OPTS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(turn!.assistant.content).toContain('一起吃');
  });
});
