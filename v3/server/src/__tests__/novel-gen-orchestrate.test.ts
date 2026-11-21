/**
 * M2 Task 3.2 测试：orchestrateNovelChapters 章节编排移植语义。
 * fixture 书落临时 DATA_DIR（novel-gen-assemble.test.ts 同款隔离模式）；
 * 上游 LLM 经全局 fetch mock 按脚本序列应答（SSE 流式 / JSON 非流式按请求体分流）。
 * 覆盖：分段拼接 / 截断续写 ≤4 轮 / meta 重试 / 重放回滚 / swipe 候选 / 取消段间与章间 /
 * 章失败不入库已入库保留 / 多章链 outline / 润色生效与失败静默 / continue / append / expand / 书已删除。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultNovelSettings, type NovelSettings, type Work } from '@shared/work';
import type { Message } from '@shared/message';
import { META_ONLY_PLACEHOLDER } from '@shared/engine/prompt/postprocess';
import { META_RETRY_SUFFIX, MAX_TRUNCATE_ROUNDS } from '@shared/hooks/novel-constants';

import { orchestrateNovelChapters, type OrchestrateInput, type TaskProgress } from '../services/novel-gen/orchestrate';
import { upsertMessageInternal } from '../routes/works/messages';
import { readWork, worksDir } from '../routes/works/works';
import { readAll, rewriteAll } from '../storage/jsonl';
import { writeJsonAtomic, readJson } from '../storage/store';

let root = '';

const WID = 'w-orch-1';

/** 编排 prefs（thinking 缺省=开；polishModel 等测试按需附加） */
const PREFS = { source: 'openai' as const, model: 'm3' };

function mkWork(settings: Partial<NovelSettings> = {}, overrides: Partial<Work> = {}): Work {
  return {
    id: WID,
    revision: 1,
    title: '编排测试书',
    mode: 'novel',
    genre: '兄妹',
    characterIds: [],
    worldbookIds: [],
    factionIds: [],
    itemIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: { ...defaultNovelSettings, targetChapterWords: 2000, ...settings },
    voiceMap: {},
    stats: { messageCount: 0, chapterCount: 0, charCount: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Work;
}

async function seedWork(work: Work): Promise<void> {
  await writeJsonAtomic(join(worksDir(), work.id, 'work.json'), work);
}

/** messages.jsonl 路径（与 messages.ts 同一布局） */
function messagesPath(id: string): string {
  return join(worksDir(), id, 'messages.jsonl');
}

/** 章节消息最小构造 */
function chapterMsg(id: string, index: number, content: string): Message {
  return {
    id,
    role: 'assistant',
    name: '小说家',
    content,
    createdAt: 1,
    swipes: [{ id: `${id}-v1`, name: 'v1', content, origin: 'ai', createdAt: 1 }],
    swipeId: 0,
    chapter: { index, title: `第${index}章` },
    extra: {},
  };
}

async function seedMessages(msgs: Message[]): Promise<void> {
  await rewriteAll(messagesPath(WID), msgs);
}

async function readMessages(): Promise<Message[]> {
  return readAll<Message>(messagesPath(WID));
}

// ---------- 上游 mock：按脚本序列应答（SSE 流式 / JSON 非流式按请求体分流） ----------

interface ScriptEntry {
  /** 流式正文 */
  sse?: { text: string; finish?: string };
  /** 非流式 JSON 正文（润色/抽取） */
  json?: string;
  /** 非 200 响应（瞬态失败用） */
  status?: number;
}

let calls: Array<Record<string, unknown>> = [];
let script: ScriptEntry[] = [];

function sseResponse(text: string, finish: string): Response {
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`,
    'data: [DONE]\n\n',
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/**
 * 装载脚本化上游 mock（越界调用重复末项）。
 * onCall：第 idx 号调用应答后的副作用（cancel 置位等）；gate：指定序号调用前挂起（runner e2e 用）。
 */
function mockUpstream(
  entries: ScriptEntry[],
  opts: { onCall?: (idx: number) => void; gate?: { at: number; hold: Promise<void> } } = {},
): void {
  calls = [];
  script = entries;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: unknown, init?: { body?: string }) => {
      const idx = calls.length;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push(body);
      if (opts.gate && idx === opts.gate.at) await opts.gate.hold;
      const entry = script[Math.min(idx, script.length - 1)];
      const res =
        entry.status !== undefined
          ? new Response('boom', { status: entry.status })
          : entry.json !== undefined
            ? new Response(JSON.stringify({ choices: [{ message: { content: entry.json } }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            : sseResponse(entry.sse?.text ?? '', entry.sse?.finish ?? 'stop');
      opts.onCall?.(idx);
      return res;
    }),
  );
}

/** 进度事件收集器 */
function makeProgressSink(): { events: TaskProgress[]; onProgress: (p: TaskProgress) => void } {
  const events: TaskProgress[] = [];
  return { events, onProgress: (p) => events.push(p) };
}

/** orchestrate 入参快捷封装 */
async function runOrchestrate(extra: Partial<OrchestrateInput>): Promise<Awaited<ReturnType<typeof orchestrateNovelChapters>>> {
  const { events, onProgress } = makeProgressSink();
  return orchestrateNovelChapters({
    workId: WID,
    prefs: PREFS,
    mode: 'chapter',
    directive: '写第一章',
    chapters: 1,
    outline: false,
    isCancelled: () => false,
    onProgress,
    ...extra,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'v3-novel-gen-orchestrate-'));
  process.env.DATA_DIR = root;
  await writeFile(join(root, 'secrets.json'), JSON.stringify({ openai: { apiKey: 'mock-key' } }), 'utf8');
  await seedWork(mkWork());
  await seedMessages([]);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.LLM_TASK_RETRY_DELAYS_MS;
  await rm(root, { recursive: true, force: true });
});

describe('单章链（generateChapter 移植语义）', () => {
  it('分段两段拼接：tw>SEGMENT_WORDS → parts=2，段间续写语义 + 同 id 幂等覆盖', async () => {
    await seedWork(mkWork({ targetChapterWords: 5000 })); // ceil(5000/2500)=2 段
    mockUpstream([
      { sse: { text: '# 第1章 夜雨\n第一段写完了。', finish: 'length' } },
      { sse: { text: '第二段接着推进剧情。', finish: 'stop' } },
    ]);
    const { events } = makeProgressSink();
    const result = await runOrchestrate({ onProgress: (p) => events.push(p) });
    expect(result.done).toBe(1);
    expect(result.failed).toBeUndefined();
    expect(result.messageIds).toHaveLength(1);
    const rows = await readMessages();
    expect(rows).toHaveLength(1);
    // client 平价：第 2 段 finalize 的 title 兜底（续写指令首句）落在库行，内存还原不落库
    // （client SSE 通路同款行为——重放/重开分支才回写还原；挂账与 client 一并修复）
    expect(rows[0]?.chapter?.index).toBe(1);
    expect(rows[0]?.content).toBe('第一段写完了。第二段接着推进剧情。'); // 段拼接
    const phases = events.map((e) => e.phase);
    expect(phases).toContain('assembling');
    expect(phases).toContain('generating');
    expect(phases).toContain('continuing'); // 第 2 段续写轮
    expect(phases).toContain('saving');
    const saving = events.find((e) => e.phase === 'saving');
    expect(saving?.done).toBe(1);
    // 第 2 段请求携带续写要求块
    const second = calls[1] as { messages: Array<{ content: string }> };
    expect(second.messages.map((m) => m.content).join('\n')).toContain('续写要求');
  });

  it('截断自动续写上限 ≤4 轮：finish=length 连续触发也只补 4 轮', async () => {
    // 每轮新增片段 ≥8 字（<8 会被重放检测按空转轮回滚——isReplayedContinuation 空转阈值）
    mockUpstream([
      { sse: { text: '起点。', finish: 'length' } },
      { sse: { text: '一轮续写推进剧情发展。', finish: 'length' } },
      { sse: { text: '二轮续写继续向前推进。', finish: 'length' } },
      { sse: { text: '三轮续写冲突进一步升级。', finish: 'length' } },
      { sse: { text: '四轮续写走向本章收束。', finish: 'length' } },
      { sse: { text: '五轮不应发生新内容。', finish: 'length' } },
    ]);
    const result = await runOrchestrate({});
    expect(result.done).toBe(1);
    expect(vi.mocked(fetch).mock.calls.length).toBe(1 + MAX_TRUNCATE_ROUNDS); // 初次 + 4 轮
    const rows = await readMessages();
    expect(rows[0]?.content).toContain('四轮续写');
    expect(rows[0]?.content).not.toContain('五轮不应发生');
    expect(rows[0]?.extra?.truncatedSwipeId).toBe(0); // 末轮仍截断 → 版本级未写完标记
  });

  it('截断续写轮 tail 接线 continueRemaining：要求块字数行切「补写约 N 字后收束」（防膨胀激活）', async () => {
    // 首轮 5 字截断 → remaining = max(400, 2000−5) = 1995；续写轮要求块按剩余字数收束，
    // 不再「写约 targetWords−targetWords+1500 字」满额再写（章节逐轮膨胀的根因）
    mockUpstream([
      { sse: { text: '秋夜很长。', finish: 'length' } },
      { sse: { text: '续写补完剩余剧情后自然收尾。', finish: 'stop' } },
    ]);
    const result = await runOrchestrate({});
    expect(result.done).toBe(1);
    const second = calls[1] as { messages: Array<{ content: string }> };
    const joined = second.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('补写约 1995 字后自然收束'); // continueRemaining 进要求块（tail 接线）
    expect(joined).toContain('本章总计约 2000 字'); // 收束口径锚定 targetWords
  });

  it('meta 占位重试：首输出 META_ONLY_PLACEHOLDER → 后缀重试成功 + 同 id 幂等覆盖', async () => {
    mockUpstream([
      { sse: { text: META_ONLY_PLACEHOLDER, finish: 'stop' } },
      { sse: { text: '重试后的正文。', finish: 'stop' } },
    ]);
    const result = await runOrchestrate({});
    expect(result.done).toBe(1);
    const rows = await readMessages();
    expect(rows).toHaveLength(1); // 占位行被重试结果覆盖，不产生重复章节行
    expect(rows[0]?.content).toBe('重试后的正文。');
    // 重试请求携带 META_RETRY_SUFFIX 后缀，且预算提到 3 倍（openai 上游请求体为扁平结构）
    const retry = calls[1] as { messages: Array<{ content: string }>; max_tokens: number };
    const joined = retry.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('系统重试指令');
    expect(joined).toContain(META_RETRY_SUFFIX.trim().slice(0, 20));
    // 新公式：tw=2000 → ceil(2500×0.75)=1875 < floor 2048 → floor 顶格 × scale 2（3→2 见 chapterChain meta 注释）
    expect(retry.max_tokens).toBe(2048 * 2);
  });

  it('重放检测回滚：续写轮从头复述前文 → 回滚为已写内容并停止', async () => {
    const full = '春'.repeat(50) + '。';
    mockUpstream([
      { sse: { text: `# 第1章 夜雨\n${full}`, finish: 'length' } },
      { sse: { text: full, finish: 'length' } }, // raw=initialBuffer+text → next=partial+partial 全文重放
    ]);
    const result = await runOrchestrate({});
    expect(result.done).toBe(1);
    const rows = await readMessages();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe(full); // 回滚为已写内容（未吞入重放副本）
    expect(rows[0]?.chapter?.title).toBe('夜雨');
    expect(vi.mocked(fetch).mock.calls.length).toBe(2); // 回滚后链即停
  });

  it('书不存在 → failed 区分「作品已删除」', async () => {
    mockUpstream([]);
    const result = await runOrchestrate({ workId: 'w-gone-1' });
    expect(result.done).toBe(0);
    expect(result.failed).toContain('作品已删除');
  });
});

describe('swipe / continue / append / expand 模式', () => {
  it('swipe 模式：候选 append 进目标消息（旧候选保留）', async () => {
    const target = chapterMsg('m-t', 1, '旧版本正文。');
    target.directive = '写第一章';
    await seedMessages([target]);
    mockUpstream([{ sse: { text: '重写的新版本正文。', finish: 'stop' } }]);
    const result = await runOrchestrate({ mode: 'swipe', targetId: 'm-t' });
    expect(result).toEqual({ done: 1, messageIds: ['m-t'] });
    const rows = await readMessages();
    expect(rows[0]?.swipes).toHaveLength(2);
    expect(rows[0]?.swipeId).toBe(1);
    expect(rows[0]?.swipes[0]?.content).toBe('旧版本正文。');
    expect(rows[0]?.content).toBe('重写的新版本正文。');
  });

  it('swipe 候选满额 → 拒绝且不调用上游', async () => {
    const target = chapterMsg('m-t', 1, '旧正文。');
    target.swipes = Array.from({ length: 50 }, (_, i) => ({
      id: `sv-${i}`, name: `v${i}`, content: `v${i}`, origin: 'ai' as const, createdAt: 1,
    }));
    await seedMessages([target]);
    mockUpstream([]);
    const result = await runOrchestrate({ mode: 'swipe', targetId: 'm-t' });
    expect(result.done).toBe(0);
    expect(result.failed).toContain('候选已达上限');
    expect(vi.mocked(fetch).mock.calls.length).toBe(0);
  });

  it('continue 模式：partial 为基底 + 续写指令入库（上下文含半成品伪消息）', async () => {
    mockUpstream([{ sse: { text: '窗外的雨还没有停。', finish: 'stop' } }]);
    const result = await runOrchestrate({ mode: 'continue', partial: '夜里他翻来覆去睡不着，' });
    expect(result.done).toBe(1);
    const rows = await readMessages();
    expect(rows[0]?.content).toBe('夜里他翻来覆去睡不着，窗外的雨还没有停。');
    expect(rows[0]?.directive).toContain('接着写完这一章');
    const body = calls[0] as { messages: Array<{ content: string }> };
    expect(body.messages.map((m) => m.content).join('\n')).toContain('夜里他翻来覆去睡不着');
  });

  it('append 模式：旧文+新文拼接为候选版本（上下文含本章本体）', async () => {
    await seedMessages([chapterMsg('m-t', 1, '原章正文。')]);
    mockUpstream([{ sse: { text: '后续新剧情展开。', finish: 'stop' } }]);
    const result = await runOrchestrate({ mode: 'append', targetId: 'm-t' });
    expect(result.done).toBe(1);
    expect(result.messageIds).toEqual(['m-t']);
    const rows = await readMessages();
    expect(rows[0]?.content).toBe('原章正文。后续新剧情展开。'); // buffer 种子语义：旧文+新文
    expect(rows[0]?.swipes).toHaveLength(2);
    const body = calls[0] as { messages: Array<{ content: string }> };
    const joined = body.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('续写要求'); // continuation 要求块
    expect(joined).toContain('原章正文。'); // 本章本体在上下文
  });

  it('expand 模式：扩写要求块 + 新候选为完整扩写稿', async () => {
    await seedMessages([chapterMsg('m-t', 1, '原章正文。')]);
    mockUpstream([{ sse: { text: '# 第1章 重题\n扩写后的完整正文。', finish: 'stop' } }]);
    const result = await runOrchestrate({ mode: 'expand', targetId: 'm-t' });
    expect(result.done).toBe(1);
    const rows = await readMessages();
    expect(rows[0]?.content).toBe('扩写后的完整正文。'); // expand 无 buffer 种子：候选=模型全文
    expect(rows[0]?.swipes).toHaveLength(2);
    const body = calls[0] as { messages: Array<{ content: string }> };
    const joined = body.messages.map((m) => m.content).join('\n');
    expect(joined).toContain('扩写要求');
    expect(joined).toContain('把本章加长扩写');
  });
});

describe('取消与失败语义（D6）', () => {
  it('cancel 段间生效：停链返回已 done，已入库段保留', async () => {
    await seedWork(mkWork({ targetChapterWords: 5000 })); // parts=2
    let cancelled = false;
    mockUpstream([{ sse: { text: '# 第1章 起\n第一段。', finish: 'length' } }], {
      onCall: (idx) => {
        if (idx === 0) cancelled = true; // 第 1 段完成后置位
      },
    });
    const result = await runOrchestrate({ isCancelled: () => cancelled });
    expect(result.done).toBe(0);
    expect(result.failed).toBeUndefined(); // 取消非失败
    expect(result.messageIds).toEqual([]);
    const rows = await readMessages();
    expect(rows).toHaveLength(1); // 已入库段保留（D6）
    expect(rows[0]?.content).toContain('第一段。');
  });

  it('cancel 章间生效：第 1 章完成后停链，done=1', async () => {
    let cancelled = false;
    mockUpstream([{ sse: { text: '# 第1章 起\n第一章正文。', finish: 'stop' } }], {
      onCall: (idx) => {
        if (idx === 0) cancelled = true;
      },
    });
    const result = await runOrchestrate({ chapters: 2, isCancelled: () => cancelled });
    expect(result.done).toBe(1);
    expect(result.messageIds).toHaveLength(1);
    expect(await readMessages()).toHaveLength(1);
  });

  it('章失败不入库已入库保留：chapters=2 第 2 章上游持续 500 → 停链 failed', async () => {
    process.env.LLM_TASK_RETRY_DELAYS_MS = '5,5,5,5,5';
    mockUpstream([
      { sse: { text: '# 第1章 开端\n第一章正文写完了。', finish: 'stop' } },
      { status: 500 },
    ]);
    const result = await runOrchestrate({ chapters: 2 });
    expect(result.done).toBe(1);
    expect(result.failed).toContain('上游无有效输出');
    expect(result.messageIds).toHaveLength(1); // 仅第 1 章计入 result
    const rows = await readMessages();
    expect(rows[0]?.chapter?.index).toBe(1);
    expect(rows[0]?.content).toBe('第一章正文写完了。');
    // client 平价：末次无效输出的占位行以幂等 id 落库（sanitizeOutput('') 回退占位——
    // 「库中该 id 行已被末次输出覆盖」同款语义），但 result 不计入该章
    expect(rows).toHaveLength(2);
    expect(rows[1]?.content).toBe(META_ONLY_PLACEHOLDER);
  });
});

describe('多章链与批次屏障', () => {
  it('chapters=2 + outline：第 2 章 wire 与入库 directive=OUTLINE_DIRECTIVE', async () => {
    mockUpstream([
      { sse: { text: '# 第1章 开端\n第一章正文。', finish: 'stop' } },
      { sse: { text: '# 第2章 发展\n第二章正文。', finish: 'stop' } },
    ]);
    const result = await runOrchestrate({ chapters: 2, outline: true, directive: '写兄妹第一章' });
    expect(result.done).toBe(2);
    expect(result.messageIds).toHaveLength(2);
    const rows = await readMessages();
    expect(rows.map((r) => r.chapter?.index)).toEqual([1, 2]);
    expect(rows[0]?.directive).toBe('写兄妹第一章');
    expect(rows[1]?.directive).toBe('按本章大纲写'); // OUTLINE_DIRECTIVE 入库
    const first = calls[0] as { messages: Array<{ content: string }> };
    const second = calls[1] as { messages: Array<{ content: string }> };
    expect(first.messages.map((m) => m.content).join('\n')).toContain('写兄妹第一章');
    expect(second.messages.map((m) => m.content).join('\n')).toContain('按本章大纲写');
    // 第 2 章上下文包含第 1 章正文（链式承接）
    expect(second.messages.map((m) => m.content).join('\n')).toContain('第一章正文。');
  });

  it('非 outline 多章链：第 2 章空指令自由发挥', async () => {
    mockUpstream([
      { sse: { text: '# 第1章 开端\n第一章正文。', finish: 'stop' } },
      { sse: { text: '# 第2章 发展\n第二章正文。', finish: 'stop' } },
    ]);
    const result = await runOrchestrate({ chapters: 2 });
    expect(result.done).toBe(2);
    expect((await readMessages())[1]?.directive).toBeUndefined(); // 空指令不入库 directive
  });
});

describe('润色 pass（polishModel）', () => {
  it('润色生效：第二模型全文润色 + 同 id 幂等覆盖 + polishing 进度', async () => {
    mockUpstream([
      { sse: { text: '# 第1章 题\n原稿正文。', finish: 'stop' } },
      { json: '润色稿正文，语言更细腻。' },
    ]);
    const { events } = makeProgressSink();
    const result = await runOrchestrate({ prefs: { ...PREFS, polishModel: 'polisher-m' }, onProgress: (p) => events.push(p) });
    expect(result.done).toBe(1);
    const rows = await readMessages();
    expect(rows[0]?.content).toBe('润色稿正文，语言更细腻。');
    expect(rows[0]?.swipes[0]?.content).toBe('润色稿正文，语言更细腻。'); // 激活版本写回
    expect(events.some((e) => e.phase === 'polishing')).toBe(true);
    const polish = calls[1] as { stream?: boolean; model: string; messages: Array<{ role: string; content: string }> };
    expect(polish.stream).toBeFalsy(); // 非流式（openai 上游体省略 stream:false）
    expect(polish.model).toBe('polisher-m');
    expect(polish.messages[0]?.role).toBe('system');
    expect(polish.messages[0]?.content).toContain('资深小说编辑');
  });

  it('润色失败静默保留原稿（不阻塞返回）', async () => {
    mockUpstream([
      { sse: { text: '# 第1章 题\n原稿正文。', finish: 'stop' } },
      { status: 500 },
    ]);
    const result = await runOrchestrate({ prefs: { ...PREFS, polishModel: 'polisher-m' } });
    expect(result.done).toBe(1);
    expect((await readMessages())[0]?.content).toBe('原稿正文。');
  });

  it('meta/崩溃稿不润色（invalidReasonOf 拦截，白烧一次调用被避免）', async () => {
    mockUpstream([
      { sse: { text: META_ONLY_PLACEHOLDER, finish: 'stop' } },
      { sse: { text: META_ONLY_PLACEHOLDER, finish: 'stop' } }, // 后缀重试仍占位
    ]);
    const result = await runOrchestrate({ prefs: { ...PREFS, polishModel: 'polisher-m' } });
    expect(result.done).toBe(0);
    expect(result.failed).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.length).toBe(2); // 初次 + 后缀重试，无第三次润色调用
    expect(await readMessages()).toHaveLength(1); // 占位行已入库（重试仍占位覆盖其上）
  });
});

describe('入库直调（upsertMessageInternal）', () => {
  it('同 id 幂等覆盖整行替换 + 新章追加 + stats 缓存同步', async () => {
    const base = chapterMsg('m-1', 1, '第一版。');
    await seedMessages([base]);
    const rev1 = await upsertMessageInternal(WID, { ...base, content: '修订版。' });
    expect(typeof rev1).toBe('number');
    let rows = await readMessages();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe('修订版。');
    const rev2 = await upsertMessageInternal(WID, chapterMsg('m-2', 2, '第二章。'));
    expect(typeof rev2).toBe('number');
    rows = await readMessages();
    expect(rows).toHaveLength(2);
    const work = await readWork(WID);
    expect(work.stats?.chapterCount).toBe(2); // stats 缓存同步
    expect(work.stats?.charCount).toBeGreaterThan(0);
    const disk = await readJson<{ revision: number }>(join(worksDir(), WID, 'work.json'));
    expect(disk?.revision).toBe(work.revision); // stats 通道不动 revision（与 HTTP 通道一致）
  });
});
