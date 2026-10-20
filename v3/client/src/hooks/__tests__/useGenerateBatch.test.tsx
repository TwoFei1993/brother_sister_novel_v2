/**
 * useGenerate.runBatch 一键连写集成测试（harness 同 useGenerate.test：fetch stub + Probe 组件）
 * 覆盖：连写到目标章数即停（恰好 N 章请求）/ 首章携指令后续空 / 中途 stop 终止循环 /
 * 流中错误帧终止循环 / 已达目标零请求。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import { buildChapterMessage } from '../generation-flow';
import { useGenerationStore } from '../../stores/generation';
import { useSettingsStore } from '../../stores/settings';
import { useWorkStore } from '../../stores/work';

import { useGenerate } from '../useGenerate';

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

function workFixture(desiredChapterCount: number): Work {
  return {
    id: 'w1',
    revision: 1,
    title: '连写测试',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings, desiredChapterCount },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

// ---------- fetch stub ----------
type FetchCall = { path: string; init: RequestInit };
let calls: FetchCall[] = [];
let generateBodies: { messages: { content: string }[] }[] = [];

/** 常规 stub：每章流正常结束；generateCalls 记录请求体 */
function stubBatchRoute(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, init: init ?? {} });
      if (path === '/api/llm/generate') {
        generateBodies.push(JSON.parse(String(init?.body)) as { messages: { content: string }[] });
        return sseResponse(['data: {"text":"章节正文内容，足够长的一段话。"}\n\n', 'data: [DONE]\n\n']);
      }
      if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
      if (path === '/api/works/w1/messages') return jsonRes({ ok: true, revision: 2 });
      throw new Error(`unmocked fetch: ${path}`);
    }),
  );
}

// ---------- hook harness ----------
const roots: Root[] = [];
let latest: ReturnType<typeof useGenerate> | null = null;

function Probe(): null {
  latest = useGenerate();
  return null;
}

async function renderHook(): Promise<void> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<Probe />);
  });
}

function seedChapter(index: number): Message {
  return buildChapterMessage({
    content: `第${index}章正文`,
    title: `第${index}章`,
    chapterIndex: index,
    directive: '旧指令',
    promptTokens: 1,
    generationMs: 1,
  });
}

beforeEach(() => {
  calls = [];
  generateBodies = [];
  useGenerationStore.getState().reset();
  useWorkStore.setState({ messages: [] });
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
  useWorkStore.setState({ messages: [] });
});

describe('useGenerate.runBatch（一键连写）', () => {
  it('desired=3 恰好连写 3 章：首章携指令、后续空指令（仅写作要求），入库 3 条', async () => {
    stubBatchRoute();
    await renderHook();
    await act(async () => {
      await latest!.runBatch(workFixture(3), '兄妹进入城堡');
    });
    expect(generateBodies).toHaveLength(3);
    expect(calls.filter((c) => c.path.endsWith('/messages'))).toHaveLength(3);

    // 输出守卫（novel）固定追加在消息最末尾——指令/写作要求改为在守卫之前的消息中断言
    const bodyOf = (i: number) => {
      const msgs = generateBodies[i]!.messages;
      return msgs[msgs.length - 2]!.content;
    };
    expect(generateBodies[0]!.messages.at(-1)!.content).toContain('输出守卫');
    expect(bodyOf(0)).toContain('剧情指引：兄妹进入城堡');
    expect(bodyOf(0)).toContain('【本章写作要求】');
    expect(bodyOf(1)).toContain('【本章写作要求】');
    expect(bodyOf(1)).not.toContain('剧情指引');
    expect(bodyOf(2)).not.toContain('剧情指引');

    expect(useGenerationStore.getState().error).toBeNull();
  });

  it('已达目标章数（下一章号 > 目标）→ 零请求直接返回', async () => {
    stubBatchRoute();
    useWorkStore.setState({ messages: [seedChapter(1), seedChapter(2), seedChapter(3)] });
    await renderHook();
    await act(async () => {
      await latest!.runBatch(workFixture(3), '不会再写');
    });
    expect(calls).toHaveLength(0);
  });

  it('连写每批上限 3 章（BATCH_CHUNK_SIZE）：desired=10 首批只写 3 章，重复点击续写 4-10', async () => {
    stubBatchRoute();
    await renderHook();
    const work = workFixture(10);

    await act(async () => {
      await latest!.runBatch(work, '首章指令');
    });
    expect(generateBodies).toHaveLength(3); // 单批上限，不一口气写满 10 章

    await act(async () => {
      await latest!.runBatch(work, '');
    });
    expect(generateBodies).toHaveLength(6); // 第二批 4-6

    await act(async () => {
      await latest!.runBatch(work, '');
    });
    expect(generateBodies).toHaveLength(9); // 第三批 7-9

    await act(async () => {
      await latest!.runBatch(work, '');
    });
    expect(generateBodies).toHaveLength(10); // 最后只剩第 10 章

    await act(async () => {
      await latest!.runBatch(work, '');
    });
    expect(generateBodies).toHaveLength(10); // 达标后零请求
    expect(useGenerationStore.getState().error).toBeNull();
  });

  it('中途 stop()：当前章中止（不入库）且不再发起下一章，batch 归 null', async () => {
    // 第一章流挂起不关闭（模拟长生成）；abort 时主动 error（真实 fetch 中止时读取会拒绝）
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({ path, init: init ?? {} });
        if (path === '/api/llm/generate') {
          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"text":"写到一半"}\n\n'));
              (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => {
                // 与真实 fetch 中止一致：AbortError 命名错误（jsdom 的 DOMException 不满足 isAbort 的 instanceof Error）
                const abortErr = new Error('The user aborted a request.');
                abortErr.name = 'AbortError';
                controller.error(abortErr);
              });
            },
          });
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
        throw new Error(`unmocked fetch: ${path}`);
      }),
    );
    await renderHook();
    let promise: Promise<void> | null = null;
    act(() => {
      promise = latest!.runBatch(workFixture(5), '第一章指令');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30)); // 等第一章流起来
      latest!.stop();
      await promise;
    });

    expect(calls.filter((c) => c.path === '/api/llm/generate')).toHaveLength(1); // 只发起第一章
    expect(calls.some((c) => c.path.endsWith('/messages'))).toBe(false); // 半成品不入库
    const store = useGenerationStore.getState();
    expect(store.error).toBeNull(); // 用户停止非错误
    expect(store.partialKept).toBe(true); // 半成品保留可「继续」
    expect(store.buffer).toBe('写到一半');
  });

  it('某章流中错误帧 → 循环终止（不重试不发后续章），error 进 store', async () => {
    let generateCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({ path, init: init ?? {} });
        if (path === '/api/llm/generate') {
          generateCalls += 1;
          if (generateCalls === 2) {
            return sseResponse(['data: {"error":{"code":"LLM_TIMEOUT","message":"上游超时"}}\n\n']);
          }
          return sseResponse(['data: {"text":"第一章正文，足够长。"}\n\n', 'data: [DONE]\n\n']);
        }
        if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
        if (path === '/api/works/w1/messages') return jsonRes({ ok: true, revision: 2 });
        throw new Error(`unmocked fetch: ${path}`);
      }),
    );
    await renderHook();
    await act(async () => {
      await latest!.runBatch(workFixture(5), '第一章指令');
    });
    expect(generateCalls).toBe(2); // 第一章成功、第二章错误即停
    expect(useGenerationStore.getState().error).toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(calls.filter((c) => c.path.endsWith('/messages'))).toHaveLength(1); // 仅第一章入库
  });
});
