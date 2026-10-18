/**
 * LLM 代理路由（设计 §6 / §3.2）：generate（SSE 流式/非流式）、test 探活、tokenize 计数
 *
 * 全部需登录（authRequired）；无状态不落盘（§9.2）——生成内容由前端暂存与入库。
 * 流式帧协议：增量 `data: {"text": "...", "raw": <上游原chunk>}`，收束 `data: [DONE]`，
 * 流中错误 `data: {"error": {code, message}}`；未开流前的错误一律 502 JSON {code, message}。
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import type { GenParams, LlmSource } from '../converters';
import { authRequired } from '../middleware/auth';
import { zodBody } from '../middleware/validate';
import { LlmError, runGenerate, type StreamEvent } from '../services/llm';
import { countTokens } from '../services/tokenize';

/** Express 4 不自动捕获 async rejection，统一 wrap（与 works 组同模式） */
function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: (e?: unknown) => void): void => {
    fn(req, res).catch(next);
  };
}

const sourceSchema = z.enum(['openai', 'claude', 'gemini']);

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  name: z.string().optional(),
  content: z.string(),
});

const paramsSchema = z
  .object({
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_tokens: z.number().optional(),
  })
  .passthrough();

const generateSchema = z.object({
  source: sourceSchema,
  model: z.string().min(1, 'model 不能为空'),
  messages: z.array(messageSchema).min(1, 'messages 不能为空'),
  params: paramsSchema.optional(),
  stream: z.boolean().optional(),
});

const testSchema = z.object({ source: sourceSchema, model: z.string().optional() });

const tokenizeSchema = z
  .object({
    source: sourceSchema,
    model: z.string().optional(),
    text: z.string().optional(),
    messages: z.array(z.object({ content: z.string() })).optional(),
  })
  .refine((b) => b.text !== undefined || b.messages !== undefined, {
    message: 'text 与 messages 至少提供一个',
  });

/** test 探活兜底模型（各通道便宜小模型；调用方可显式指定覆盖） */
const TEST_MODEL: Record<LlmSource, string> = {
  openai: 'gpt-4o-mini',
  claude: 'claude-3-5-haiku-latest',
  gemini: 'gemini-1.5-flash',
};

/** SSE 头（禁用代理缓冲，X-Accel-Buffering 供 nginx 场景） */
function openSse(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function sendEvent(res: Response, ev: StreamEvent): void {
  if (ev.kind === 'text') {
    res.write(`data: ${JSON.stringify({ text: ev.text, raw: ev.raw })}\n\n`);
  } else if (ev.kind === 'done') {
    res.write('data: [DONE]\n\n');
  } else {
    res.write(`data: ${JSON.stringify({ error: { code: ev.code, message: ev.message } })}\n\n`);
  }
}

function errorPayload(e: unknown): { code: string; message: string } {
  if (e instanceof LlmError) return { code: e.code, message: e.message };
  return { code: 'LLM_NET', message: '服务器内部错误，请查看服务端日志' };
}

export const llmRouter = Router();

llmRouter.use(authRequired);

llmRouter.post('/llm/generate', zodBody(generateSchema), wrap(async (req, res) => {
  const { source, model, messages, params, stream = false } = req.body as {
    source: LlmSource;
    model: string;
    messages: Parameters<typeof runGenerate>[0]['messages'];
    params?: GenParams;
    stream?: boolean;
  };
  const events = runGenerate({ source, model, messages, params, stream });

  if (!stream) {
    let text = '';
    try {
      for await (const ev of events) {
        if (ev.kind === 'text') text += ev.text;
      }
    } catch (e) {
      res.status(502).json(errorPayload(e));
      return;
    }
    res.json({ text });
    return;
  }

  // 流式：先取第一个事件（此时已完成 fetch 与状态码检查），失败则尚未开流 → 502 JSON
  try {
    const first = await events.next();
    openSse(res);
    if (first.done) {
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    sendEvent(res, first.value);
    for await (const ev of events) sendEvent(res, ev);
    res.end();
  } catch (e) {
    res.status(502).json(errorPayload(e));
  }
}));

llmRouter.post('/llm/test', zodBody(testSchema), wrap(async (req, res) => {
  const { source, model } = req.body as { source: LlmSource; model?: string };
  try {
    const events = runGenerate({
      source,
      model: model ?? TEST_MODEL[source],
      messages: [{ role: 'user', content: 'hi' }],
      params: { max_tokens: 5 },
      stream: false,
    });
    for await (const ev of events) {
      if (ev.kind === 'error') {
        res.json({ ok: false, code: ev.code });
        return;
      }
    }
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, code: errorPayload(e).code });
  }
}));

llmRouter.post('/tokenize', zodBody(tokenizeSchema), wrap(async (req, res) => {
  const { source, model, text, messages } = req.body as {
    source: LlmSource;
    model?: string;
    text?: string;
    messages?: Array<{ content: string }>;
  };
  const full = text ?? (messages ?? []).map((m) => m.content).join('\n');
  res.json(await countTokens(source, model, full));
}));
