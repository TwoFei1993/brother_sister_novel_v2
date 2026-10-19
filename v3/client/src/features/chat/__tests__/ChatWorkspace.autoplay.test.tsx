/**
 * ChatWorkspace 轮换可见化 + 自动连播集成测试（用户反馈四问①/④）
 *
 * 场景 A：手动指定妹妹发送 → 完成后 manualPick 自动清除，提示复位为「下一位：哥哥」
 * 场景 B：开启自动连播 → 手动 1 轮后自动以「轮换下一位+空引导」连发 members.length 轮暂停；
 *         自动轮为隐式引导（不入库 user 消息），末尾注入长度 hint（绑定预设路径同样生效）
 * 双成员 mock：[哥哥, 妹妹]；fetch stub 与 ChatWorkspace.test.tsx 同模式。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultNovelSettings, type Work } from '@shared/work';

import { useGenerationStore } from '../../../stores/generation';
import { useSettingsStore } from '../../../stores/settings';
import { useWorkStore } from '../../../stores/work';

vi.mock('../../../api/library', () => ({
  listCharacters: vi.fn(async () => [
    { id: 'c1', name: '哥哥' },
    { id: 'c2', name: '妹妹' },
  ]),
}));

import ChatWorkspace from '../ChatWorkspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    id: 'w-auto',
    revision: 1,
    title: '轮换作品',
    mode: 'chat',
    genre: 'hunhe',
    characterIds: ['c1', 'c2'],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings, chatReplyLength: 'medium' },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

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
  await act(async () => {}); // flush 成员加载
  return container;
}

interface PostedMessage {
  role: string;
  name?: string;
  content: string;
}

/** fetch stub 组装：记录 generate 请求体与入库消息；SSE 每轮回复「<文本>[DONE]」 */
function stubGeneration(): {
  generateBodies: { messages: { role: string; content: string }[] }[];
  posted: PostedMessage[];
} {
  const generateBodies: { messages: { role: string; content: string }[] }[] = [];
  const posted: PostedMessage[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/llm/generate') {
        generateBodies.push(JSON.parse(String(init?.body)));
        return sseResponse(['data: {"text":"好的"}\n\n', 'data: [DONE]\n\n']);
      }
      if (path === '/api/works/w-auto/messages') {
        posted.push(JSON.parse(String(init?.body)));
        return jsonRes({ ok: true });
      }
      if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
      throw new Error(`unmocked fetch: ${path}`);
    }),
  );
  return { generateBodies, posted };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useGenerationStore.getState().reset();
  useWorkStore.getState().reset();
  useSettingsStore.getState().setLlmPrefs({ source: 'openai', model: 'gpt-4o' });
});

afterEach(async () => {
  vi.useRealTimers();
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

describe('轮换可见化 + 自动连播（四问①/④）', () => {
  it('场景 A：手动指定发送完成后 manualPick 自动清除，提示复位为「下一位：下一位轮换者」', async () => {
    stubGeneration();
    useWorkStore.setState({ work: baseWork(), messages: [] });
    const c = await renderWorkspace(baseWork());

    // 无历史时下一位=首位哥哥；点选妹妹 → 「已指定：妹妹」
    expect(c.querySelector('[data-testid="member-mode-tag"]')?.textContent).toBe('下一位：哥哥');
    await click(c, '[data-id="c2"]');
    expect(c.querySelector('[data-testid="member-mode-tag"]')?.textContent).toBe('已指定：妹妹');

    await type(c, '[data-testid="chat-input"]', '今天去哪玩');
    await click(c, '[data-testid="chat-send"]');
    await act(async () => {});

    // 完成后手动指定清除：最后发言=妹妹，轮换下一位=哥哥
    expect(c.querySelector('[data-testid="member-mode-tag"]')?.textContent).toBe('下一位：哥哥');
    const roles = useWorkStore.getState().messages;
    expect(roles.map((m) => [m.role, m.name])).toEqual([
      ['user', '用户'],
      ['assistant', '妹妹'],
    ]);
  });

  it('场景 B：自动连播手动 1 轮后连发 2 轮暂停；自动轮空引导不入库 user 且末尾注入长度 hint', async () => {
    const { generateBodies, posted } = stubGeneration();
    useWorkStore.setState({ work: baseWork(), messages: [] });
    const c = await renderWorkspace(baseWork());

    // 开启自动（空闲 → 按延迟启动第一轮）
    await click(c, '[data-testid="auto-play-toggle"]');
    expect(c.querySelector('[data-testid="auto-play-toggle"]')?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await act(async () => {}); // flush 第 1 轮完成
    expect(generateBodies).toHaveLength(1);

    // 手动发送第 2 轮（重置满额配额=2）
    await type(c, '[data-testid="chat-input"]', '继续吧');
    await click(c, '[data-testid="chat-send"]');
    await act(async () => {});
    expect(generateBodies).toHaveLength(2);

    // 自动第 3 轮（延迟 1.5s）：空引导隐式发送
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await act(async () => {});
    expect(generateBodies).toHaveLength(3);

    // 自动第 4 轮（配额第 2 条）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await act(async () => {});
    expect(generateBodies).toHaveLength(4);

    // 自动第 5 轮：配额尽 → 暂停等待用户
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await act(async () => {});
    expect(generateBodies).toHaveLength(4);

    // 轮换：assistant name 依次 哥哥→妹妹→哥哥→妹妹（无历史基准从首位起）
    const assistantNames = posted.filter((m) => m.role === 'assistant').map((m) => m.name);
    expect(assistantNames).toEqual(['哥哥', '妹妹', '哥哥', '妹妹']);
    // 入库：仅手动 1 轮写入 user 消息（自动轮空引导为隐式，不入库）
    expect(posted.filter((m) => m.role === 'user')).toHaveLength(1);
    // 自动轮末尾为长度 hint system（绑定预设与否均注入的统一后处理）
    const lastMsg = generateBodies[2]!.messages.at(-1)!;
    expect(lastMsg.role).toBe('system');
    expect(lastMsg.content).toContain('400-900');
    // 出错/暂停后开关保持开启但配额尽；localStorage 记忆开启态
    expect(localStorage.getItem('v3-auto-chat-w-auto')).toBe('1');
  });
});
