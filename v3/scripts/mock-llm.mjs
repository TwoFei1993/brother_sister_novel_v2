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

/** 章号从请求历史推断（无次序依赖）：历史已有第 N 章 → 返回 N+1；新作品 → 第 1 章。
 *  修复：此前按调用次数递增，多次跑 smoke/演练时计数错位（第 2 次起标题断言必挂）。 */
function nextChapterNo(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  let max = 0;
  for (const m of msgs) {
    for (const mm of String(m?.content ?? '').matchAll(/第(\d+)章/g)) {
      max = Math.max(max, Number(mm[1]));
    }
  }
  return max + 1;
}

/** 短剧拆镜头 mock（e2e 用）：system 含「短剧分镜师」→ 返回镜头 JSON 数组文本。
 *  含 A5/B1 新字段（endState/hookType），驱动分镜 tab 断言。 */
const STORYBOARD_JSON = JSON.stringify([
  {
    shotSize: '中景', cameraMove: '推', actionStart: '巷口转身', actionEnd: '背墙滑坐',
    staging: '画面中央', dialog: '你到底隐瞒了什么！', durationSec: 6, sound: '雨声与雷声，脚步与呼吸声',
    gridParts: [
      '李薇在昏黄路灯下的湿滑巷口猛地转身，风衣下摆甩起水珠；她眉头紧锁张嘴嘶吼，握手机的手指节泛白；逆光剪影，霓虹在湿地面映出冷蓝反光。',
      '李薇向前逼近一步，雨水顺着发梢滴落，手机屏幕的光照亮她泛红的眼眶；她咬紧下唇，胸口剧烈起伏。',
      '李薇伸手抓住对方衣袖用力一扯，两人距离骤然拉近；雨水在两人之间溅起细碎水花，霓虹灯在积水中碎成光斑。',
      '李薇背靠砖墙缓缓滑坐在地，手机滑落到积水里；她仰头靠墙，泪水和雨水混在一起，嘴唇微微颤抖。',
    ],
    endState: '李薇背靠砖墙坐在积水中，手机落在脚边屏幕朝上',
    hookType: 'reversal',
    characters: [], scene: '',
  },
  {
    shotSize: '特写', cameraMove: '固定', actionStart: '手机亮屏', actionEnd: '瞳孔收缩',
    staging: '画面中央偏下', dialog: '', durationSec: 4, sound: '只有雨滴敲击屏幕的声音',
    gridParts: [
      '积水中的手机屏幕亮起，一条新消息弹出，冷白光照亮水面涟漪。',
      '特写李薇缓缓睁大的眼睛，瞳孔中映出屏幕冷光，睫毛上挂着水珠。',
      '她的手指在积水里朝手机方向挪动，指尖触到手机边缘却停住。',
      '瞳孔骤然收缩，水珠从睫毛坠落，画面定格在她骤变的神情上。',
    ],
    endState: '李薇瞳孔收缩的特写定格',
    hookType: 'reveal',
    characters: [], scene: '',
  },
]);

/** 剧本拆解 mock（e2e 用）：system 含「短剧制片审核助手」→ 返回审核卡 JSON（含 1 集，驱动分镜 tab） */
const BREAKDOWN_JSON = JSON.stringify({
  summary: '记者李薇雨夜追查线索，逼问线人未果后从手机里发现更大秘密。',
  eventChain: ['雨夜巷口逼问', '线人逃脱', '手机发现秘密'],
  conflict: '真相追查与自身安全的对抗',
  characterRelations: '李薇与线人是单线联系的调查依赖关系',
  emotionPoints: ['压抑紧张', '震惊'],
  visualActions: ['攥紧手机指节泛白', '猛地转身逼视'],
  riskReplacements: [],
  episodes: [{ index: 1, title: '雨夜真相', synopsis: '李薇巷口逼问线人，发现手机里的惊天秘密。' }],
});

/** 流水线 mock（e2e 用）：角色/场景提取 JSON——拆解 onDone 自动流水线三步全通的关键 */
const CHARACTERS_JSON = JSON.stringify([
  { name: '李薇', profile: '28岁女记者，身形利落。黑色齐肩发微湿贴颊，深棕色瞳，眉骨清晰下颌线紧；身高165cm；米色长风衣配深灰高领与直筒裤，黑色短靴；左腕旧机械表；气质警觉锋利。' },
]);
const SCENES_JSON = JSON.stringify([
  { name: '雨夜巷口', spec: '狭窄双向巷道，湿滑沥青地面映霓虹；砖墙斑驳带锈迹铁门；顶光昏黄路灯逆光剪影，冷蓝霓虹辅光；深夜暴雨，冷暖对撞；关键道具：巷口垃圾桶、墙面小广告。' },
]);

/** 按 system prompt 分发：短剧全家桶（拆解/角色/场景/分镜）返回对应 JSON，其余返回章节文本 */
function replyText(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const sysOf = (m) => (String(m?.role) === 'system' ? String(m?.content ?? '') : '');
  const sys = msgs.map(sysOf).join('\n');
  if (sys.includes('短剧制片审核助手')) return BREAKDOWN_JSON;
  if (sys.includes('短剧角色设计师')) return CHARACTERS_JSON;
  if (sys.includes('短剧美术指导')) return SCENES_JSON;
  if (sys.includes('短剧分镜师')) return STORYBOARD_JSON;
  return chapterText(nextChapterNo(body));
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && (req.url ?? '').includes('/chat/completions')) {
    calls += 1;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let parsedBody;
      try {
        parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        captureRequest(parsedBody);
      } catch {
        /* 非 JSON body 跳过捕获 */
      }
      const text = replyText(parsedBody);
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
    });
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
