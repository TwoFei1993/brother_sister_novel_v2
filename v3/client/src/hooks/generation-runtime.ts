/**
 * 生成流共享 run 内核（useGenerate / useChatGenerate 公共编排骨架，review #7 管线去重）
 *
 * 职责：防重入 → model 前置校验 → store.start → 组装（prepare 委托）
 *   → SSE 流消费（网络类错误 + 0 chunk 指数退避重试 ≤2）→ 收尾（finalize 委托）
 *   → 失败 fail（已产出内容 partialKept=true 保留半成品供「继续」；用户停止 error=null）
 * novel 与 chat 的差异全部收口在 prepare/finalize 闭包：
 *   novel = directive 通道 + 章节后处理入库；chat = userMessage 通道 + user/assistant 成对入库。
 * 不含 React hook；调用方（hook）经 bindController 注册 AbortController 以支持 stop()。
 */
import { generateStream, type GenerateBody } from '../api/llm';
import { createThinkSplitter } from '../lib/think-split';
import { TypewriterPacer } from '../lib/reading/typewriter';
import { useGenerationStore } from '../stores/generation';
import { useSettingsStore, type LlmPrefs } from '../stores/settings';

import {
  GenerationFlowError,
  retryDelayMs,
  shouldRetry,
  sleep,
  toGenerationError,
  type GenerationError,
} from './generation-flow';

/** 组装产物：请求体 + 完成收尾委托（闭包捕获资产/宏环境/组装期上下文） */
export interface PreparedStream<T> {
  body: GenerateBody;
  finalize: () => Promise<T>;
}

export interface RunStreamOptions<T> {
  workId: string;
  /** 目标消息 id（前端预生成 uuid，入库幂等键） */
  targetId: string;
  /** 「继续」场景的半成品基底 */
  initialBuffer: string;
  /** 注册本轮 AbortController（供调用方 stop()）；本轮结束（成功/失败）后以 null 回调 */
  bindController: (controller: AbortController | null) => void;
  /** 组装阶段：拉资产/扫描总装/构造请求体；失败按生成错误处理（0 chunk 可重试） */
  prepare: (ctx: { prefs: LlmPrefs; startedAt: number }) => Promise<PreparedStream<T>>;
  /** 打字机匀速逐字显示（novel 章节生成开启；chat 缺省直通保持既有时序） */
  pace?: boolean;
}

/** 单次生成流编排（返回 null = 未产出结果，错误已写入 generationStore） */
export async function runGenerationStream<T>(opts: RunStreamOptions<T>): Promise<T | null> {
  if (useGenerationStore.getState().streaming) return null; // 防重入
  const prefs = useSettingsStore.getState().llmPrefs;
  if (!prefs.model) {
    useGenerationStore.getState().fail({ code: 'LLM_NOMODEL', message: '请先在设置页选择模型' }, false);
    return null;
  }

  useGenerationStore.getState().start(opts.workId, opts.targetId, opts.initialBuffer);
  const startedAt = Date.now();
  const controller = new AbortController();
  opts.bindController(controller);
  let chunksReceived = 0;
  let attempt = 0;
  let streamError: GenerationError | null = null;

  // 打字机匀速：SSE chunk 先进 pacer 缓冲，再按固定节奏逐字进 store（中转攒批返回也平滑）。
  // chat 模式保持直通（intervalMs=0），不改变其既有时序。
  const pacer = new TypewriterPacer(
    (text) => useGenerationStore.getState().appendChunk(text),
    opts.pace ? 24 : 0,
  );
  // 思考流匀速（推理模型思考期可达数十秒）：实时可视化避免「卡死」体感；novel 走打字机、chat 直通
  const thinkingPacer = new TypewriterPacer(
    (text) => useGenerationStore.getState().appendThinking(text),
    opts.pace ? 24 : 0,
  );
  // <think> 内联标签分流器：openai 兼容端点把思考混在 content 流里（如 MiniMax-M3），
  // 逐段拆开各归各桶——novel/chat 都生效；claude 通道思考走独立帧不受影响
  const thinkSplit =
    useSettingsStore.getState().llmPrefs.source === 'openai' ? createThinkSplitter() : null;

  try {
    const { body, finalize } = await opts.prepare({ prefs, startedAt });

    // ---------- 流式阶段（网络类错误 + 0 chunk → 指数退避重试 ≤2） ----------
    for (;;) {
      streamError = null;
      try {
        await generateStream(
          body,
          {
            onChunk: (text) => {
              chunksReceived += 1;
              if (thinkSplit) {
                const r = thinkSplit.split(text);
                if (r.content) pacer.push(r.content);
                if (r.thinking) thinkingPacer.push(r.thinking);
                return;
              }
              pacer.push(text);
            },
            // 思考流累积（D4）：经思考打字机匀速进 thinkingBuffer，finalize 时优先入 extra.rawThinking
            onThinking: (thinking) => thinkingPacer.push(thinking),
            // 上游结束原因透传进 store（'length'/'max_tokens' = 输出被截断；截断自动续写的决定性信号）
            onFinish: (reason) => useGenerationStore.getState().setFinishReason(reason),
            onDone: () => undefined,
            onError: (e) => {
              streamError = toGenerationError(e); // 流中错误帧：中止读取，统一走 catch
              controller.abort();
            },
          },
          controller.signal,
        );
        break;
      } catch (err) {
        if (streamError) throw new GenerationFlowError(streamError);
        if (controller.signal.aborted) throw err; // 用户停止
        const ge = toGenerationError(err);
        if (shouldRetry(ge, chunksReceived, attempt)) {
          attempt += 1;
          await sleep(retryDelayMs(attempt), controller.signal);
          continue;
        }
        throw err;
      }
    }

    // 等缓冲区逐字吐完再收尾：buffer 只含已显示文字，最后一屏不会突然弹出
    if (thinkSplit) {
      const tail = thinkSplit.flush();
      if (tail.content) pacer.push(tail.content);
      if (tail.thinking) thinkingPacer.push(tail.thinking);
    }
    await Promise.all([pacer.drained(), thinkingPacer.drained()]);

    // ---------- 完成收尾（novel=章节入库 / chat=成对入库，由 finalize 委托） ----------
    return await finalize();
  } catch (err) {
    pacer.flushSync(); // 停止/出错时把已收到未显示的内容一次性补进 buffer，partialKept 不丢字
    thinkingPacer.flushSync();
    const ge = err instanceof GenerationFlowError ? err.ge : toGenerationError(err);
    const partialKept = chunksReceived > 0 || opts.initialBuffer.length > 0;
    if (ge.code === 'aborted' && streamError === null) {
      useGenerationStore.getState().fail(null, partialKept); // 用户停止：非错误
    } else {
      useGenerationStore.getState().fail(ge, partialKept);
    }
    return null;
  } finally {
    pacer.stop();
    thinkingPacer.stop();
    opts.bindController(null);
  }
}
