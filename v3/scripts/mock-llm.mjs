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
 * 请求捕获：每次 /chat/completions 的完整 body（messages/params）追加落盘到
 * `logs/mock-llm-captures.jsonl`（最新一条另存 `logs/mock-llm-last-request.json`），
 * 供 M3 验收核对上游实际收到的组装结果（作者注释深度/世界书条目/{{char}} 替换）。
 *
 * 用法：node scripts/mock-llm.mjs [port]   （默认 3100）
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

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

/** 捕获请求 body：追加 jsonl + 最新快照（路径相对进程 cwd，验收时在 v3/ 下启动） */
function captureRequest(body) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), calls, body });
    appendFileSync(resolve('logs/mock-llm-captures.jsonl'), line + '\n');
    writeFileSync(resolve('logs/mock-llm-last-request.json'), JSON.stringify(body, null, 2));
  } catch {
    /* 捕获失败不影响流式返回（logs/ 不存在等） */
  }
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && (req.url ?? '').includes('/chat/completions')) {
    calls += 1;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        captureRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        /* 非 JSON body 跳过捕获 */
      }
    });
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
    // 客户端真断开才停止推送。不能监听 req 'close'：Node ≥16 中请求流读完 body 即触发
    // 'close'（M3 验收发现——捕获 body 后必然触发，会误杀推送），响应流 'close' 才等于连接断开。
    res.on('close', () => clearInterval(timer));
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
