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
import { TypewriterPacer } from '../lib/typewriter';
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
              pacer.push(text);
            },
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
    await pacer.drained();

    // ---------- 完成收尾（novel=章节入库 / chat=成对入库，由 finalize 委托） ----------
    return await finalize();
  } catch (err) {
    pacer.flushSync(); // 停止/出错时把已收到未显示的内容一次性补进 buffer，partialKept 不丢字
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
    opts.bindController(null);
  }
}
