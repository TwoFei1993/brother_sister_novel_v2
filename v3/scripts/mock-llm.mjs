#!/usr/bin/env node
/**
 * mock LLM SSE server（工具性质，Task 20 验收用）：OpenAI 兼容假上游
 *
 * 实现 POST /v1/chat/completions（stream:true）：
 *   以 OpenAI chat.completions chunk 帧格式流式返回固定小说章节文本，
 *   末尾 `data: [DONE]`。供 v3 server 的 openai 通道（secrets baseUrl 指向本服务）
 *   在无真实密钥环境下走通「生成→流式渲染→标题解析→入库」全链路。
 *
 * 章节：首行 `# 第N章 …`（服务端后处理会解析成 chapter.title），
 * 章号按调用次数递增；env MOCK_LLM_XSS=1 时正文注入 XSS 样本（人工验证净化管道）。
 *
 * 用法：node scripts/mock-llm.mjs [port]   （默认 3100）
 */
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? process.env.MOCK_LLM_PORT ?? 3100);
/** 每 chunk 携带的字符数（控制流式节奏观感） */
const CHUNK_CHARS = Number(process.env.MOCK_LLM_CHUNK ?? 24);
/** 帧间隔 ms（太快看不出流式效果；MOCK_LLM_TICK_MS 可放大以便人手点停止） */
const TICK_MS = Number(process.env.MOCK_LLM_TICK_MS ?? 40);

let calls = 0;

/** 固定章节文本：首行标题（会被后处理剥离入库 chapter.title）+ 三段正文 + 粗体 */
function chapterText(n) {
  const xss = process.env.MOCK_LLM_XSS === '1'
    ? '\n<script>alert(1)</script>\n[xss](javascript:alert(1))\n<img src=x onerror="alert(2)">\n'
    : '';
  return [
    `# 第${n}章 试炼之门`,
    '',
    '晨光刺破云层，少年在废墟之上睁开双眼。远处石门的裂缝中渗出幽蓝光芒，仿佛沉睡千年的呼吸。',
    xss,
    `妹妹攥住他的衣角，声音压得很低："**哥，门后有东西在看着我们。**"`,
    '',
    '他握紧手中的断剑，向前迈出一步。风停了，世界安静得只剩下两个人的心跳。',
  ].join('\n');
}

/** OpenAI chunk 帧 */
function frame(text) {
  return JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: text } }] });
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && (req.url ?? '').includes('/chat/completions')) {
    calls += 1;
    const text = chapterText(calls);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    let i = 0;
    const timer = setInterval(() => {
      if (i >= text.length) {
        clearInterval(timer);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.write(`data: ${frame(text.slice(i, i + CHUNK_CHARS))}\n\n`);
      i += CHUNK_CHARS;
    }, TICK_MS);
    req.on('close', () => clearInterval(timer));
    return;
  }
  // 探活
  if ((req.url ?? '').includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-novel' }] }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'mock-llm 仅实现 POST /v1/chat/completions' }));
});

server.listen(PORT, () => {
  console.log(`[mock-llm] http://localhost:${PORT}/v1 （secrets openai.baseUrl 填 http://localhost:${PORT}/v1，apiKey 任意）`);
});
