/**
 * 作品文学质量评测（LLM-as-judge + 机械文学指标）
 *
 * 用法：node scripts/quality-eval.mjs "<作品标题关键字>" [--judge] [--base http://localhost:3001]
 * 输出：data/quality-reports/<作品名>.md
 *
 * 机械指标（零成本，全本地）：
 *  - AI 腔词表密度（每千字命中次数，词表对照实测泄露形态与 AI 写作特征归纳）
 *  - 句长均值/方差（方差过低 = 节奏单调）
 *  - 对话行占比、段落长度
 *  - 跨章开头句式重复（模型签名句式，如「X 是从…开始的」）
 * LLM 评审（--judge，走 /api/llm/generate 真实通道）：
 *  - 每章五维 1-5 分：叙事结构 / 人物塑造 / 文笔语言 / 节奏张力 / 指令贴合
 *  - 全书维度：跨章一致性 / 节奏曲线 / 套路重复度
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR ? path.resolve(ROOT, process.env.DATA_DIR) : path.resolve(ROOT, 'data');
const args = process.argv.slice(2);
const titleKey = args[0];
const doJudge = args.includes('--judge');
const baseIdx = args.indexOf('--base');
const BASE = baseIdx > -1 ? args[baseIdx + 1] : 'http://localhost:3001';
const PASSWORD = process.env.ACCESS_PASSWORD || 'dev123';
const MODEL = process.env.EVAL_MODEL || 'MiniMax-M3';

if (!titleKey) {
  console.error('用法：node scripts/quality-eval.mjs "<作品标题关键字>" [--judge]');
  process.exit(1);
}

// ---------- 数据读取 ----------
function findWork(key) {
  const dir = path.join(DATA, 'works');
  for (const id of fs.readdirSync(dir)) {
    try {
      const work = JSON.parse(fs.readFileSync(path.join(dir, id, 'work.json'), 'utf8'));
      if (work.title.includes(key)) {
        const messages = fs
          .readFileSync(path.join(dir, id, 'messages.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l))
          .filter((m) => m.chapter)
          .sort((a, b) => a.chapter.index - b.chapter.index);
        return { id, work, messages };
      }
    } catch { /* 跳过坏行 */ }
  }
  return null;
}

// ---------- 机械文学指标 ----------
const AI_CLICHE = [
  '空气仿佛凝固', '嘴角勾起', '一抹', '深不可测', '不易察觉', '眼底闪过', '一丝',
  '仿佛在诉说', '无声的呐喊', '心中一凛', '瞳孔骤缩', '如遭雷击', '恍若隔世',
  '时间仿佛', '温度仿佛', '深意', '意味深长', '若有若无', '隐隐约约', '莫名的',
];

const count = (text, re) => (text.match(re) ?? []).length;

function chapterMetrics(content) {
  const body = content.replace(/^#[^\n]*\n/, '').trim();
  const chars = body.replace(/\s/g, '').length;
  // 句子边界：句末标点 + 换行；>300 字的未断块（模型漏标点）按 300 计入均值并单独计数
  const rawSentences = body.split(/[。！？…\n]+/).filter((s) => s.trim().length > 1);
  const lens = rawSentences.map((s) => Math.min(300, s.replace(/\s/g, '').length));
  const longBlocks = rawSentences.filter((s) => s.replace(/\s/g, '').length > 300).length;
  const mean = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lens.length);
  const dialogueLines = body.split('\n').filter((l) => /^[「『"']|”[”』]$/.test(l.trim())).length;
  const lines = body.split('\n').filter((l) => l.trim().length > 1).length;
  const clicheHits = {};
  let clicheTotal = 0;
  for (const w of AI_CLICHE) {
    const n = count(body, new RegExp(w, 'g'));
    if (n > 0) { clicheHits[w] = n; clicheTotal += n; }
  }
  const uniqueChars = new Set(body.replace(/\s/g, '')).size;
  return {
    chars,
    sentences: lens.length,
    longBlocks,
    meanSentenceLen: +mean.toFixed(1),
    sentenceLenSd: +Math.sqrt(variance).toFixed(1),
    dialogueRatio: +(dialogueLines / Math.max(1, lines)).toFixed(2),
    clichePerKilo: +(clicheTotal / Math.max(0.5, chars / 1000)).toFixed(1),
    clicheHits,
    typeTokenRatio: +(uniqueChars / Math.max(1, chars)).toFixed(2),
    opening: body.slice(0, 24),
    formulaOpening: /是从[^，。。\n]{0,14}开始的|^.{0,6}的风是从/.test(body),
  };
}

// ---------- LLM 评审 ----------
let cookie = '';
async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`登录失败：${res.status}`);
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function judge(system, user, maxTokens = 900) {
  const res = await fetch(`${BASE}/api/llm/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      source: 'claude',
      model: MODEL,
      stream: false,
      params: { max_tokens: maxTokens, temperature: 0.2 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const out = await res.json();
  const text = out.text ?? '';
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return { _raw: text.slice(0, 200) };
  try { return JSON.parse(m[0]); } catch { return { _raw: text.slice(0, 300) }; }
}

const CHAPTER_RUBRIC = `你是资深中文网文编辑，按行业标准严格评审单章质量。只依据文本本身，不打人情分。
输出严格 JSON（无其他文字）：
{"叙事":1-5,"人物":1-5,"文笔":1-5,"节奏":1-5,"贴合":1-5,"总评":"30字内","亮点":["…"],"问题":["…"]}
维度：叙事=场景组织与信息释放；人物=言行是否符合人物且有声口区分；文笔=语言质感与画面感；节奏=详略与张力推进；贴合=对剧情指令的完成度。`;

function overallRubric(chapters) {
  const digest = chapters
    .map((c) => `第${c.index}章（${c.len}字）：${c.opening}…`)
    .join('\n');
  return `你是资深网文主编，评审一部 ${chapters.length} 章作品的跨章质量。各章开头与字数：
${digest}

输出严格 JSON（无其他文字）：
{"一致性":1-5,"节奏曲线":1-5,"套路重复":1-5,"追读力":1-5,"总评":"50字内","问题":["…"]}
维度：一致性=设定/人物/称谓跨章稳定；节奏曲线=详略分布与高潮排布；套路重复=跨章句式/桥段复用（5=几乎无重复）；追读力=往下读的欲望。`;
}

// ---------- 主流程 ----------
const found = findWork(titleKey);
if (!found) {
  console.error(`找不到标题含「${titleKey}」的作品`);
  process.exit(1);
}
const { work, messages } = found;
console.log(`评测：《${work.title}》 ${messages.length} 章`);

const chapters = messages.map((m) => ({
  index: m.chapter.index,
  title: m.chapter.title,
  directive: m.directive ?? '',
  len: m.content.replace(/\s/g, '').length,
  content: m.content,
  metrics: chapterMetrics(m.content),
}));

// 机械指标：跨章开头句式重复
const formulaCount = chapters.filter((c) => c.metrics.formulaOpening).length;
const openings = chapters.map((c) => `  第${c.index}章 ${c.metrics.opening}`);

// LLM 评审
let chapterJudges = [];
let overallJudge = null;
if (doJudge) {
  await login();
  for (const c of chapters) {
    process.stdout.write(`评审第 ${c.index} 章…`);
    const j = await judge(
      CHAPTER_RUBRIC,
      `【剧情指令】${c.directive || '（无，自由续写）'}\n【本章正文】\n${c.content.slice(0, 6000)}`,
    );
    chapterJudges.push({ index: c.index, ...j });
    console.log(` 叙事${j.叙事} 人物${j.人物} 文笔${j.文笔} 节奏${j.节奏} 贴合${j.贴合}`);
  }
  process.stdout.write('评审全书…');
  overallJudge = await judge(
    '你是资深网文主编。只输出严格 JSON，无其他文字。',
    overallRubric(chapters.map((c) => ({ index: c.index, len: c.len, opening: c.metrics.opening }))),
    700,
  );
  console.log(' done');
}

// ---------- 报告 ----------
const avg = (key) => (chapterJudges.length
  ? +(chapterJudges.reduce((a, j) => a + (Number(j[key]) || 0), 0) / chapterJudges.length).toFixed(2)
  : null);
const totalChars = chapters.reduce((a, c) => a + c.len, 0);

const lines = [
  `# 文学质量评测：《${work.title}》`,
  '',
  `> ${new Date().toLocaleString('zh-CN')} ｜ ${messages.length} 章 · ${totalChars} 字 ｜ 评审：机械指标${doJudge ? ' + LLM(MiniMax-M3)' : '（未启用 LLM）'}`,
  '',
  '## 一、总览',
  '',
  '| 指标 | 值 |',
  '| --- | --- |',
  `| 章均字数 | ${Math.round(totalChars / chapters.length)} |`,
  `| 单章字数区间 | ${Math.min(...chapters.map((c) => c.len))} ~ ${Math.max(...chapters.map((c) => c.len))} |`,
  `| AI 腔密度（每千字） | ${(chapters.reduce((a, c) => a + c.metrics.clichePerKilo, 0) / chapters.length).toFixed(1)} |`,
  `| 章均句长 / 波动 | ${chapters[0].metrics.meanSentenceLen} / ${chapters.map((c) => c.metrics.sentenceLenSd).join(', ')} |`,
  `| 对话占比区间 | ${Math.min(...chapters.map((c) => c.metrics.dialogueRatio))} ~ ${Math.max(...chapters.map((c) => c.metrics.dialogueRatio))} |`,
  `| 跨章签名句式（「X 是从…开始的」类开头） | ${formulaCount}/${chapters.length} 章 |`,
  ...(doJudge
    ? [`| 叙事/人物/文笔/节奏/贴合（均分） | ${avg('叙事')} / ${avg('人物')} / ${avg('文笔')} / ${avg('节奏')} / ${avg('贴合')} |`]
    : []),
  ...(doJudge && overallJudge
    ? [`| 一致性/节奏曲线/套路重复/追读力 | ${overallJudge.一致性} / ${overallJudge['节奏曲线']} / ${overallJudge['套路重复']} / ${overallJudge['追读力']} |`]
    : []),
  '',
  '## 二、逐章明细',
  '',
  '| 章 | 字数 | 句长±波动 | 对话比 | AI腔/千字 | 签名开头 |' + (doJudge ? ' 叙事/人物/文笔/节奏/贴合 |' : ''),
  '| --- | --- | --- | --- | --- | --- |' + (doJudge ? ' --- |' : ''),
  ...chapters.map((c) => {
    const j = chapterJudges.find((x) => x.index === c.index);
    return `| ${c.index} | ${c.len} | ${c.metrics.meanSentenceLen}±${c.metrics.sentenceLenSd} | ${c.metrics.dialogueRatio} | ${c.metrics.clichePerKilo} | ${c.metrics.formulaOpening ? '⚠ 是' : '否'} |` + (doJudge ? ` ${j?.叙事 ?? '?'} / ${j?.人物 ?? '?'} / ${j?.文笔 ?? '?'} / ${j?.节奏 ?? '?'} / ${j?.贴合 ?? '?'} |` : '');
  }),
  '',
  '## 三、跨章开头句式（重复套路观察）',
  '',
  ...openings,
  '',
  '## 四、AI 腔命中明细（全书）',
  '',
  ...(Object.entries(
    chapters.reduce((acc, c) => {
      for (const [w, n] of Object.entries(c.metrics.clicheHits)) acc[w] = (acc[w] ?? 0) + n;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w, n]) => `- 「${w}」× ${n}`)),
  '',
  ...(doJudge
    ? ['## 五、LLM 评审意见', '',
       ...chapters.map((c) => {
         const j = chapterJudges.find((x) => x.index === c.index);
         return `**第${c.index}章**：${j?.总评 ?? ''}\n- 亮点：${(j?.亮点 ?? []).join('；') || '—'}\n- 问题：${(j?.问题 ?? []).join('；') || '—'}`;
       }),
       '',
       `**全书总评**：${overallJudge?.总评 ?? ''}`,
       `- 问题：${(overallJudge?.问题 ?? []).join('；') || '—'}`,
      ]
    : []),
];

const outDir = path.join(DATA, 'quality-reports');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${work.title}.md`);
fs.writeFileSync(outFile, lines.join('\n'));
console.log(`\n报告已写入：${outFile}`);
