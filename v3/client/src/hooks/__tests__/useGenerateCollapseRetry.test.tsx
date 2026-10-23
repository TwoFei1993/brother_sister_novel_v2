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

function sseResponse(text: string, finish?: string): Response {
  const encoder = new TextEncoder();
  const frame: Record<string, unknown> = { text };
  if (finish) frame.raw = { choices: [{ delta: {}, finish_reason: finish }] }; // 上游 raw 透传（finish_reason 提取源）
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const COLLAPSED = '正文。' + '刀——刀'.repeat(200); // 4-gram「刀——刀」×200 ≥100 → 崩溃
const VALID = '第1章正文，足够长的一段叙述，含对话与场景，自然收束。';
/** 句号完整收尾的半章（标点启发式不触发；只有 finish_reason='length' 能判出被腰斩） */
const POLITE_HALF =
  '清晨的阳光洒进窗台，主角推开房门走了出去，看到街上人来人往一切如常，他松了口气转身回了屋。';

type GenReply = string | { text: string; finish?: string };
let generateTexts: GenReply[] = [];
let generateBodies: { messages: { content: string }[] }[] = [];
let messageBodies: { id?: string; directive?: string; content: string }[] = [];

function stubGenerateRoute(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/llm/generate') {
        generateBodies.push(JSON.parse(String(init?.body)) as { messages: { content: string }[] });
        const item = generateTexts.shift();
        const text = typeof item === 'string' ? item : (item?.text ?? VALID);
        const finish = typeof item === 'string' ? undefined : item?.finish;
        return sseResponse(text, finish);
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

  it('两次均崩溃 → 链式补救救不回 → 不上架且三次落库同 id（无孤儿行）', async () => {
    generateTexts = [COLLAPSED, COLLAPSED, VALID];
    stubGenerateRoute();
    await renderHook();
    let msg: Message | null = null;
    await act(async () => {
      msg = await latest!.generateChapter(workFixture(), [], DIRECTIVE);
    });

    // 链式补救：初稿崩溃 → 反重复后缀重试 → 仍崩（结尾无标点被截断续写接管）→
    // 续写内容拼在崩溃段后，isCollapsedText 仍命中 → 不上架（batch 以 null 终止）
    expect(generateBodies).toHaveLength(3);
    expect(msg).toBeNull();
    // 三次 run 各幂等入库一次且同一消息 id（末次覆盖，不产生重复章节行）
    expect(messageBodies).toHaveLength(3);
    expect(new Set(messageBodies.map((b) => b.id)).size).toBe(1);
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

  it('finish_reason=length 但句号收尾（启发式漏检形态）→ 决定性信号触发续写 → 拼接补完入库', async () => {
    generateTexts = [{ text: POLITE_HALF, finish: 'length' }, { text: VALID, finish: 'stop' }];
    stubGenerateRoute();
    await renderHook();
    let msg: Message | null = null;
    await act(async () => {
      msg = await latest!.generateChapter(workFixture(), [], DIRECTIVE);
    });

    // 首段句号结尾 → isTruncatedText=false；finish='length' 为决定性截断信号 → 自动续写一轮
    expect(generateBodies).toHaveLength(2);
    expect(msg).not.toBeNull();
    expect(msg!.content).toBe(POLITE_HALF + VALID); // 半章为基底拼接补完（同 id 覆盖入库）
    expect(messageBodies).toHaveLength(2);
    expect(new Set(messageBodies.map((b) => b.id)).size).toBe(1);
    expect(useGenerationStore.getState().error).toBeNull();
  });

  it('finish_reason=stop 且标点完整 → 不触发续写（单次调用）', async () => {
    generateTexts = [{ text: VALID, finish: 'stop' }];
    stubGenerateRoute();
    await renderHook();
    let msg: Message | null = null;
    await act(async () => {
      msg = await latest!.generateChapter(workFixture(), [], DIRECTIVE);
    });

    expect(generateBodies).toHaveLength(1);
    expect(msg).not.toBeNull();
    expect(msg!.content).toBe(VALID);
  });
});
