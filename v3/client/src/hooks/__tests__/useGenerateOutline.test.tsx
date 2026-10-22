/**
 * useGenerate.runByOutline 按大纲生成集成测试（harness 同 useGenerateBatch：fetch stub + Probe）
 * 反馈⑤覆盖：从下一章逐章写到大纲覆盖的最大章号（区别于目标章节数）/ 每章自动注入本章大纲
 * 要点 / 续起点衔接 / 错误即停 / 大纲覆盖完零请求 / outlineRunPlan·batchProgressText 纯函数。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@shared/message';
import { defaultNovelSettings, type Work } from '@shared/work';

import {
  batchProgressText,
  outlineRunPlan,
  OUTLINE_DIRECTIVE,
} from '../generation-flow';
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

const OUTLINES_1_3 = [
  { index: 1, title: '落地嫡长', plot: '胎穿嫡长女，隐藏空间。' },
  { index: 2, title: '私囤万千', plot: '幼年囤积。' },
  { index: 3, title: '幼学启蒙', plot: '起步碾压。' },
];

function workFixture(chapterOutlines: { index: number; title: string; plot: string }[] = OUTLINES_1_3): Work {
  return {
    id: 'w1',
    revision: 1,
    title: '按大纲测试',
    mode: 'novel',
    genre: 'hunhe',
    characterIds: [],
    worldbookIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings, chapterOutlines },
    voiceMap: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

// ---------- fetch stub ----------
let generateBodies: { messages: { content: string }[] }[] = [];

/** 常规 stub：每章流正常结束 */
function stubOutlineRoute(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/llm/generate') {
        const body = JSON.parse(String(init?.body)) as { stream?: boolean };
        if (body.stream === false) {
          return new Response(JSON.stringify({ text: '' }), { status: 200 });
        }
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

/** 输出守卫（novel）固定追加在消息最末尾——指令/大纲注入改为在守卫之前的消息中断言 */
const bodyOf = (i: number): string => {
  const msgs = generateBodies[i]!.messages;
  return msgs[msgs.length - 2]!.content;
};

beforeEach(() => {
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

describe('useGenerate.runByOutline（📖按大纲生成，反馈⑤）', () => {
  it('大纲 1-3 章、无已有章节：逐章写满 3 章，每章请求注入本章大纲要点', async () => {
    stubOutlineRoute();
    await renderHook();
    await act(async () => {
      await latest!.runByOutline(workFixture(), []);
    });
    expect(generateBodies).toHaveLength(3);
    expect(useWorkStore.getState().messages.filter((m) => m.chapter)).toHaveLength(3);

    expect(bodyOf(0)).toContain('剧情指引：按本章大纲写'); // 每章指令恒为「按本章大纲写」
    expect(bodyOf(0)).toContain('本章大纲：标题《落地嫡长》');
    expect(bodyOf(0)).toContain('胎穿嫡长女，隐藏空间。');
    expect(bodyOf(1)).toContain('本章大纲：标题《私囤万千》');
    expect(bodyOf(1)).not.toContain('落地嫡长'); // 各章只注入本章大纲
    expect(bodyOf(2)).toContain('本章大纲：标题《幼学启蒙》');
    expect(useGenerationStore.getState().error).toBeNull();
  });

  it('区别于目标章节数：desiredChapterCount=3 而大纲覆盖到 5 章 → 仍写满 5 章', async () => {
    stubOutlineRoute();
    const work = workFixture([
      ...OUTLINES_1_3,
      { index: 4, title: '锋芒初露', plot: '家宴立威。' },
      { index: 5, title: '暗流涌动', plot: '族老发难。' },
    ]);
    await renderHook();
    await act(async () => {
      await latest!.runByOutline(work, []);
    });
    expect(generateBodies).toHaveLength(5);
    expect(bodyOf(4)).toContain('本章大纲：标题《暗流涌动》');
  });

  it('从「下一章」开始：已写 2 章 → 只写第 3 章（1 次请求，注入第 3 章大纲）', async () => {
    stubOutlineRoute();
    useWorkStore.setState({ messages: [seedChapter(1), seedChapter(2)] });
    await renderHook();
    await act(async () => {
      await latest!.runByOutline(workFixture(), useWorkStore.getState().messages);
    });
    expect(generateBodies).toHaveLength(1);
    expect(bodyOf(0)).toContain('本章大纲：标题《幼学启蒙》');
    expect(useWorkStore.getState().messages.filter((m) => m.chapter)).toHaveLength(3);
  });

  it('某章流中错误帧 → 循环终止（不发后续章），已成功章保留', async () => {
    let generateCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        if (path === '/api/llm/generate') {
        const body = JSON.parse(String(init?.body)) as { stream?: boolean };
        if (body.stream === false) {
          return new Response(JSON.stringify({ text: '' }), { status: 200 });
        }
          generateCalls += 1;
          if (generateCalls === 2) {
            return sseResponse(['data: {"error":{"code":"LLM_TIMEOUT","message":"上游超时"}}\n\n']);
          }
          generateBodies.push(JSON.parse(String(init?.body)) as { messages: { content: string }[] });
          return sseResponse(['data: {"text":"第一章正文，足够长。"}\n\n', 'data: [DONE]\n\n']);
        }
        if (path === '/api/tokenize') return jsonRes({ count: 10, approximate: false });
        if (path === '/api/works/w1/messages') return jsonRes({ ok: true, revision: 2 });
        throw new Error(`unmocked fetch: ${path}`);
      }),
    );
    await renderHook();
    await act(async () => {
      await latest!.runByOutline(workFixture(), []);
    });
    expect(generateCalls).toBe(2); // 第 1 章成功、第 2 章错误即停
    expect(useGenerationStore.getState().error).toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(useWorkStore.getState().messages.filter((m) => m.chapter)).toHaveLength(1);
  });

  it('大纲已覆盖完（下一章 4 > 最大章号 3）→ 零请求直接返回', async () => {
    stubOutlineRoute();
    useWorkStore.setState({ messages: [seedChapter(1), seedChapter(2), seedChapter(3)] });
    await renderHook();
    await act(async () => {
      await latest!.runByOutline(workFixture(), useWorkStore.getState().messages);
    });
    expect(generateBodies).toHaveLength(0);
  });

  it('无大纲 → 零请求（按钮侧由 canOutline 保证，此处防御兜底）', async () => {
    stubOutlineRoute();
    await renderHook();
    await act(async () => {
      await latest!.runByOutline(workFixture([]), []);
    });
    expect(generateBodies).toHaveLength(0);
  });

  it('指令常量：OUTLINE_DIRECTIVE = 按本章大纲写', () => {
    expect(OUTLINE_DIRECTIVE).toBe('按本章大纲写');
  });
});

describe('outlineRunPlan / batchProgressText 纯函数', () => {
  it('无大纲/空数组 → null；正常区间从下一章到大纲最大章号', () => {
    expect(outlineRunPlan([], undefined)).toBeNull();
    expect(outlineRunPlan([], [])).toBeNull();
    expect(outlineRunPlan([], OUTLINES_1_3)).toEqual({ start: 1, end: 3, total: 3 });
    expect(outlineRunPlan([seedChapter(1), seedChapter(2), seedChapter(3)], OUTLINES_1_3)).toBeNull(); // 覆盖完
  });

  it('断号衔接：已写到第 1 章且大纲只含第 3 章 → 下一章 2 写到大纲最大章号 3', () => {
    const only3: { index: number }[] = [{ index: 3 }];
    expect(outlineRunPlan([seedChapter(1)], only3)).toEqual({ start: 2, end: 3, total: 2 }); // 第 2 章无大纲匹配自由发挥，第 3 章按大纲
  });

  it('进度文案：连写 3/50、按大纲 2/7（前缀区分两种批量）', () => {
    expect(batchProgressText({ done: 3, total: 50 })).toBe('3/50');
    expect(batchProgressText({ done: 2, total: 7, mode: 'outline' })).toBe('按大纲 2/7');
  });
});
