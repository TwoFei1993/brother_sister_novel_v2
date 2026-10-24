/**
 * ChatWorkspace 断流「继续」集成测试（review #2：continue 必须携带本轮发送文本）
 *
 * 场景：发送「今晚吃什么」→ 第一轮流中断（无 [DONE]，半成品保留、user 消息尚未入库）
 * → 点「继续」→ 断言第二次生成请求的上下文含本轮文本（旧实现从消息流反查会拿空）。
 * fetch stub：/api/library 成员列表经 vi.mock；生成流 SSE 按 round 切换断流/正常。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiVersion, type Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import { useGenerationStore } from '../../../stores/generation';
import { useSettingsStore } from '../../../stores/settings';
import { useWorkStore } from '../../../stores/work';

vi.mock('../../../api/library', () => ({
  listCharacters: vi.fn(async () => [{ id: 'c1', name: '小柔' }]),
}));

import ChatWorkspace from '../ChatWorkspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 构造 SSE 流式响应（与 api 层测试同模式） */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function jsonRes(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

function baseWork(): Work {
  return {
    id: 'w1',
    revision: 1,
    title: '对话作品',
    mode: 'chat',
    genre: 'hunhe',
    characterIds: ['c1'],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: defaultNovelSettings,
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

// ---------- 受控输入与点击（与 ChatView.test 同模式） ----------
async function type(container: HTMLElement, selector: string, text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(container: HTMLElement, selector: string): Promise<void> {
  await act(async () => {
    container.querySelector(selector)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const roots: Root[] = [];

async function renderWorkspace(work: Work): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<ChatWorkspace work={work} />);
  });
  // flush 成员加载（listCharacters → setMembers）
  await act(async () => {});
  return container;
}

beforeEach(() => {
  useGenerationStore.getState().reset();
  useWorkStore.getState().reset();
  useSettingsStore.getState().setLlmPrefs({ source: 'openai', model: 'gpt-4o' });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.innerHTML = '';
  useGenerationStore.getState().reset();
  useWorkStore.getState().reset();
});

describe('ChatWorkspace 断流「继续」（review #2）', () => {
  it('断流后 continue 携带本轮发送文本（发送后 user 未入库，反查会拿空）', async () => {
    const generateBodies: { messages: { role: string; content: string }[] }[] = [];
    let generateRound = 0;
    const postPaths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        if (path === '/api/llm/generate') {
          generateBodies.push(JSON.parse(String(init?.body)));
          generateRound += 1;
          // 第 1 轮：产出半成品后静默断流（无 [DONE]）；第 2 轮（继续）：正常完成
          return generateRound === 1
            ? sseResponse(['data: {"text":"我看了看冰箱"}\n\n'])
            : sseResponse(['data: {"text":"，决定煮面"}\n\n', 'data: [DONE]\n\n']);
        }
        if (path === '/api/works/w1/messages') {
          postPaths.push(path);
          return jsonRes({ ok: true, revision: 2 });
        }
        if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
        throw new Error(`unmocked fetch: ${path}`);
      }),
    );

    useWorkStore.setState({ work: baseWork(), messages: [] });
    const c = await renderWorkspace(baseWork());

    // 发送本轮消息（流中断 → 错误条 + 「继续」按钮出现）
    await type(c, '[data-testid="chat-input"]', '今晚吃什么');
    await click(c, '[data-testid="chat-send"]');
    const failed = useGenerationStore.getState();
    expect(failed.error).toMatchObject({ code: 'streamIncomplete' });
    expect(failed.partialKept).toBe(true);
    expect(c.querySelector('[data-testid="chat-continue-btn"]')).not.toBeNull();
    expect(generateRound).toBe(1);
    expect(postPaths).toHaveLength(0); // 半成品不入库

    // 「继续」：以本轮发送文本重组上下文再发起
    await click(c, '[data-testid="chat-continue-btn"]');
    expect(generateRound).toBe(2);
    const allText = JSON.stringify(generateBodies[1]!.messages);
    expect(allText).toContain('今晚吃什么'); // 本轮 userText 正确进入上下文（review #2 核心断言）

    // 继续成功：user+assistant 成对入库，错误条消失
    expect(postPaths).toHaveLength(2);
    expect(useGenerationStore.getState().error).toBeNull();
    expect(useWorkStore.getState().messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('重 roll 断流后 continue：ref 为空时回退消息流反查（既有轮次文本）', async () => {
    // 预置一轮已入库的历史：user 问 + assistant 答
    const history: Message[] = [
      { id: 'u0', role: 'user', name: '用户', content: '早上好', createdAt: 1, swipes: [aiVersion('早上好', 'v1', 1)], swipeId: 0, extra: {} },
      { id: 'a0', role: 'assistant', name: '小柔', content: '早呀', createdAt: 2, swipes: [aiVersion('早呀', 'v1', 2)], swipeId: 0, extra: {} },
    ];
    useWorkStore.setState({ work: baseWork(), messages: history });
    const generateBodies: { messages: { role: string; content: string }[] }[] = [];
    let generateRound = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        if (path === '/api/llm/generate') {
          generateBodies.push(JSON.parse(String(init?.body)));
          generateRound += 1;
          // 唯一一轮（继续）直接正常完成，聚焦断言上下文取值
          return sseResponse(['data: {"text":"续"}\n\n', 'data: [DONE]\n\n']);
        }
        if (path === '/api/works/w1/messages') return jsonRes({ ok: true, revision: 2 });
        if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
        throw new Error(`unmocked fetch: ${path}`);
      }),
    );

    const c = await renderWorkspace(baseWork());
    // 直接模拟「断流发生」（store 已置 partialKept），未经过本轮 sendMessage → ref 为空
    useGenerationStore.setState({ error: { code: 'streamIncomplete', message: '中断' }, partialKept: true });
    await act(async () => {});
    await click(c, '[data-testid="chat-continue-btn"]');
    expect(generateRound).toBe(1);
    const allText = JSON.stringify(generateBodies[0]!.messages);
    expect(allText).toContain('早上好'); // 回退反查得到历史 user 文本
  });
});
