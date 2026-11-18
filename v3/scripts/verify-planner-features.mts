/**
 * 三新功能真实验证（用户指令「先跑验证」）：走真实 LLM 通道跑一轮向导对话，逐轮断言——
 * ① 每组 questions 最后一题固定为「建议和想法」题
 * ② 策划案生成后用自己的话提调整 → 只改对应部分（自由调整模式）
 * ③ outline 产出特殊物品清单（物品资料卡数据源）
 *
 * 用法：bash scripts/verify-planner.sh   （需 dev 环境运行中：server :3001，ACCESS_PASSWORD=dev123）
 * 通道：source=claude + MiniMax-M3.1-Flash（nie-lib.ts 实测可用组合；EVAL_MODEL 可覆盖）
 */
import { PLANNER_SYSTEM, parsePlannerReply, plannerMessages, type PlannerProposal } from '../client/src/features/planner/planner-llm';

const BASE = 'http://localhost:3001';
const SOURCE = 'claude';
const MODEL = process.env.EVAL_MODEL ?? 'MiniMax-M3.1-Flash';
const PASSWORD = process.env.ACCESS_PASSWORD ?? 'dev123';

let cookie = '';
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` —— ${detail}` : ''}`);
}

/** 流式调用（完整策划案生成常超 120s 非流式空闲超时——SSE 持续有数据不会触发） */
async function llm(messages: Array<{ role: string; content: string }>): Promise<string> {
  const res = await fetch(`${BASE}/api/llm/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ source: SOURCE, model: MODEL, stream: true, params: { max_tokens: 32000, temperature: 0.8 }, messages }),
  });
  if (!res.ok || !res.body) throw new Error(`LLM 调用失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let text = '';
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (;;) {
      const idx = buf.indexOf('\n\n');
      if (idx === -1) break;
      const frame = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!frame.startsWith('data:')) continue;
      const payload = frame.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const ev = JSON.parse(payload) as { text?: string; thinking?: string; finish?: string; error?: { code?: string; message?: string } };
        if (ev.text) text += ev.text;
        if (ev.finish) finishReason = ev.finish;
        if (ev.error) streamError = `${ev.error.code ?? 'ERR'}: ${ev.error.message ?? '未知'}`;
      } catch {
        /* 半帧忽略 */
      }
    }
  }
  if (streamError) throw new Error(`流中错误帧（已收 ${text.length} 字）：${streamError}`);
  // claude 通道正常结束 = end_turn（openai = stop）；length/max_tokens 才是截断
  if (finishReason && !['stop', 'end_turn'].includes(finishReason)) {
    throw new Error(`上游非正常结束 finish=${finishReason}（已收 ${text.length} 字）`);
  }
  return text;
}

/** 上游结束原因 / 流中错误（llm() 内部捕获后抛出前记录，供诊断） */
let finishReason = '';
let streamError = '';

/** 带重试的调用：中转端点长生成偶发中断（轮 3 实测），最多 3 次 */
async function llmRetry(messages: Array<{ role: string; content: string }>, label: string): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    finishReason = '';
    streamError = '';
    try {
      const text = await llm(messages);
      if (text.trim().length > 0) return text;
      console.log(`   [${label}] 第 ${attempt} 次调用返回空文本，重试…`);
    } catch (e) {
      console.log(`   [${label}] 第 ${attempt} 次调用中断：${e instanceof Error ? e.message : e}，重试…`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`[${label}] 连续 3 次调用失败`);
}

/** 调用 + 解析，解析失败（模型 JSON 写一半自停——轮 3 实测形态）带纠正后缀重试一次 */
async function llmRound(
  messages: Array<{ role: string; content: string }>,
  label: string,
  baseline?: PlannerProposal | null,
): Promise<ReturnType<typeof parseRound>> {
  const raw = await llmRetry(messages, label);
  const parsed = parseRound(raw, baseline);
  if (parsed) return parsed;
  console.log(`   [${label}] 解析失败（len=${raw.length}）——原始输出诊断：`);
  console.log(`   HEAD: ${raw.slice(0, 400).replace(/\n/g, ' ')}`);
  console.log(`   TAIL: ${raw.slice(-300).replace(/\n/g, ' ')}`);
  const corrected = await llmRetry(
    [
      ...messages,
      {
        role: 'user' as const,
        content:
          '（系统提示：你上一轮的输出在中途结束了，JSON 没有闭合。这次请重新输出**完整严格**的 JSON：从第一个 { 到最后一个 } 完整闭合，outline 所有字段（含 volumes 与 chapters 全部条目）一次写完，不要中途停止）',
      },
    ],
    `${label}-纠正`,
  );
  return parseRound(corrected, baseline);
}

async function login(): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`登录失败 ${res.status}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  cookie = setCookie.split(';')[0] ?? '';
  if (!cookie) throw new Error('未取到会话 cookie');
}

/** 单轮对话 → 解析（复用向导同款解析器，带基准支持部分更新；解析失败再抢救一次首尾大括号） */
function parseRound(raw: string, baseline?: PlannerProposal | null): ReturnType<typeof parsePlannerReply> {
  const parsed = parsePlannerReply(raw, baseline);
  if (parsed) return parsed;
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s !== -1 && e > s) return parsePlannerReply(raw.slice(s, e + 1), baseline);
  return null;
}

const IDEA =
  '写一本都市日常向的兄妹小说：哥哥辞职开了一家深夜便利店，妹妹读高三。基调温情治愈，全书约 60 章。';

const ADJUST =
  '把第 2 章改成兄妹俩因为一件小事大吵一架；另外加一个特殊物品「母亲的银锁」——妹妹随身带着，里面藏着妈妈留下的字条。';

async function main(): Promise<void> {
  await login();
  console.log(`通道 ${SOURCE}/${MODEL}，开始三轮真实验证…\n`);

  // ---------- 轮 1：想法发散（验证 ① 建议题收尾） ----------
  const msgs1 = plannerMessages([{ role: 'user', content: IDEA }], null);
  const r1 = await llmRound(msgs1, '轮1');
  if (!r1) {
    check('轮1 解析出合法 JSON', false, '两次调用均未得到合法 JSON');
  } else {
    const qs = r1.questions;
    check('轮1 进入提问阶段（questions 非空、不出案）', qs.length > 0 && r1.proposal === null, `${qs.length} 问`);
    const last = qs[qs.length - 1]?.q ?? '';
    check('① 最后一题是「建议和想法」', /建议|想法/.test(last), `末题：「${last.slice(0, 40)}」`);
    console.log(`   问题列表：\n${qs.map((q, i) => `   ${i + 1}. ${q.q}`).join('\n')}\n`);
    var reply1 = r1.reply;
    var questions1 = qs;
  }
  // @ts-expect-error 流程变量（轮 1 失败时后续跳过）
  if (typeof questions1 === 'undefined') return finish();

  // ---------- 轮 2：出案（验证 ③ items 产出） ----------
  const answers = questions1
    .map((q, i) => `${i + 1}. 问：${q.q}\n   我选：${q.options[0] ?? '按你的专业判断来'}`)
    .join('\n');
  const history2: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: IDEA },
    { role: 'assistant', content: reply1 ?? '' },
    { role: 'user', content: `${answers}\n\n（请直接基于以上全部信息生成完整策划案：questions 传空数组、outline 一次性填全，不要再提问）` },
  ];
  const r2 = await llmRound(plannerMessages(history2, null), '轮2');
  if (!r2?.proposal) {
    check('轮2 出完整策划案', false, (r2?.reply ?? '解析失败').slice(0, 200));
    return finish();
  }
  const p2: PlannerProposal = r2.proposal;
  check('轮2 出完整策划案（chapters 8-12）', p2.extracted.chapters.length >= 8 && p2.extracted.chapters.length <= 15, `${p2.extracted.chapters.length} 章`);
  check('③ outline 产出特殊物品清单', Array.isArray(p2.extracted.items), `items: ${(p2.extracted.items ?? []).map((i) => i.name).join('、') || '（空）'}`);
  console.log(`   人物：${p2.extracted.characters.map((c) => c.name).join('、')}｜章 1：${p2.extracted.chapters[0]?.title}`);

  // ---------- 轮 3：自由调整（验证 ② 只改对应部分） ----------
  const history3 = [
    ...history2,
    { role: 'assistant', content: r2.reply },
    { role: 'user', content: ADJUST },
  ];
  const r3 = await llmRound(plannerMessages(history3, p2), '轮3', p2);
  if (!r3?.proposal) {
    check('轮3 自由调整出最新版', false, '两次调用（含纠正指令）均未得到合法 JSON');
    return finish();
  }
  const p3: PlannerProposal = r3.proposal; // 解析时已带基准合并
  const hasLock = (p3.extracted.items ?? []).some((i) => i.name.includes('银锁'));
  const ch2 = p3.extracted.chapters.find((c) => c.index === 2);
  const ch2Changed = ch2 !== undefined && /吵|争执|矛盾/.test(ch2.plot + ch2.title);
  const ch1Same = (p3.extracted.chapters.find((c) => c.index === 1)?.title ?? '') === (p2.extracted.chapters.find((c) => c.index === 1)?.title ?? '');
  check('② 调整轮继续出完整最新版', p3.extracted.chapters.length > 0, `reply: ${r3.reply.slice(0, 80)}`);
  check('②③ 调整被落实：新增物品「银锁」', hasLock, `items: ${(p3.extracted.items ?? []).map((i) => i.name).join('、')}`);
  check('② 章节定向修改：第 2 章含吵架冲突', ch2Changed, ch2 ? `第2章《${ch2.title}》：${ch2.plot.slice(0, 50)}` : '缺第 2 章');
  check('② 只改对应部分：第 1 章未被动过', ch1Same, `第1章《${p3.extracted.chapters.find((c) => c.index === 1)?.title}》`);

  finish();
}

function finish(): void {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n========== 结果：${results.length - failed.length}/${results.length} 通过 ==========`);
  if (failed.length > 0) {
    console.log('失败项：');
    for (const f of failed) console.log(`  ❌ ${f.name}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('验证脚本异常：', e instanceof Error ? e.message : e);
  process.exit(1);
});
