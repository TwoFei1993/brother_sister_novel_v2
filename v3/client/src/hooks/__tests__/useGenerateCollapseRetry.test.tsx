/**
 * useGenerate 崩溃自动重试接线测试（harness 同 useGenerateBatch：fetch stub + Probe）
 * 覆盖：重复循环崩溃首次输出 → 自动携反重复后缀重试（后缀只进提示词）/
 *       重试有效则入库且 directive 元数据干净 / 两次均崩溃返回 null 零入库 / 有效输出单次调用。
 * 崩溃判定与阈值本体见 engine/prompt/novel/collapse-detect（另有单测）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@shared/message';
import type { Work } from '@shared/work';

import { defaultNovelSettings } from '@shared/work';
import { useGenerationStore } from '../../stores/generation';
import { useSettingsStore } from '../../stores/settings';
import { useWorkStore } from '../../stores/work';

import { useGenerate } from '../useGenerate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sseResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const COLLAPSED = '正文。' + '刀——刀'.repeat(200); // 4-gram「刀——刀」×200 ≥100 → 崩溃
const VALID = '第1章正文，足够长的一段叙述，含对话与场景，自然收束。';

let generateTexts: string[] = [];
let generateBodies: { messages: { content: string }[] }[] = [];
let messageBodies: { id?: string; directive?: string; content: string }[] = [];

function stubGenerateRoute(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/llm/generate') {
        generateBodies.push(JSON.parse(String(init?.body)) as { messages: { content: string }[] });
        const text = generateTexts.shift() ?? VALID;
        return sseResponse(text);
      }
      if (path === '/api/tokenize') return new Response(JSON.stringify({ count: 10, approximate: false }), { status: 200 });
      if (path === '/api/works/w1/messages') {
        messageBodies.push(JSON.parse(String(init?.body)) as { id?: string; directive?: string; content: string });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      // 其余（资产拉取等）由 loadAssembleAssets 逐项 catch 兜底
      throw new Error(`unmocked fetch: ${path}`);
    }),
  );
}

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

function workFixture(): Work {
  return {
    id: 'w1',
    revision: 1,
    title: '崩溃重试测试',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  generateTexts = [];
  generateBodies = [];
  messageBodies = [];
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

const DIRECTIVE = '兄妹进入城堡';

describe('useGenerate 崩溃自动重试（重复循环 → 反重复后缀）', () => {
  it('首次崩溃 → 自动重试携反重复后缀 → 重试有效：入库且 directive 元数据干净', async () => {
    generateTexts = [COLLAPSED, VALID];
    stubGenerateRoute();
    await renderHook();
    let msg: Message | null = null;
    await act(async () => {
      msg = await latest!.generateChapter(workFixture(), [], DIRECTIVE);
    });

    expect(generateBodies).toHaveLength(2);
    // 后缀只进提示词：第二次请求的末位 user 消息（输出守卫前）带反重复指令
    const secondBody = JSON.stringify(generateBodies[1]);
    expect(secondBody).toContain('机械重复');
    expect(secondBody).toContain(DIRECTIVE);

    // 入库的 directive 元数据保持干净（不含机器后缀）；同 id 两次 upsert=重试覆盖首次无效行
    expect(msg).not.toBeNull();
    expect(msg!.directive).toBe(DIRECTIVE);
    expect(msg!.directive).not.toContain('机械重复');
    expect(msg!.content).toBe(VALID);
    expect(messageBodies).toHaveLength(2);
    expect(messageBodies[0]!.id).toBe(messageBodies[1]!.id); // 同 messageId 幂等覆盖（重试带首次消息 id）
    expect(messageBodies[1]!.directive).toBe(DIRECTIVE);
    expect(messageBodies[1]!.content).toBe(VALID);
    expect(useGenerationStore.getState().error).toBeNull();
  });

  it('两次均崩溃 → 返回 null（不入库）且无错误置位', async () => {
    generateTexts = [COLLAPSED, COLLAPSED];
    stubGenerateRoute();
    await renderHook();
    let msg: Message | null = null;
    await act(async () => {
      msg = await latest!.generateChapter(workFixture(), [], DIRECTIVE);
    });

    expect(generateBodies).toHaveLength(2); // 恰重试一次
    expect(msg).toBeNull();
    // 两次入库为同 id 覆盖（末次输出即落库内容），调用方不上架、本地不显示
    expect(messageBodies).toHaveLength(2);
    expect(messageBodies[0]!.id).toBe(messageBodies[1]!.id);
    expect(useGenerationStore.getState().error).toBeNull();
  });

  it('首次即有效输出 → 单次调用，directive 干净', async () => {
    generateTexts = [VALID];
    stubGenerateRoute();
    await renderHook();
    let msg: Message | null = null;
    await act(async () => {
      msg = await latest!.generateChapter(workFixture(), [], DIRECTIVE);
    });

    expect(generateBodies).toHaveLength(1);
    expect(generateBodies[0] ? JSON.stringify(generateBodies[0]) : '').not.toContain('机械重复');
    expect(msg).not.toBeNull();
    expect(msg!.directive).toBe(DIRECTIVE);
    expect(messageBodies).toHaveLength(1);
  });
});
