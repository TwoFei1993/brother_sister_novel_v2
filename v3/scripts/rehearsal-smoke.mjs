#!/usr/bin/env node
/**
 * 上线前演练冒烟（API 级，不打真实 LLM——走 compose 里的 mock-llm 假上游）
 *
 * phase1（首次）：health → 登录 → 写入 secrets（openai→mock）→ 建作品 → SSE 生成一章
 *                → 断言流式文本/标题解析/入库
 * phase2（重启后）：health → 登录 → 断言 phase1 的作品与章节仍在（数据卷持久化）
 *
 * 用法：node scripts/rehearsal-smoke.mjs phase1|phase2
 * 环境：BASE（默认 http://localhost:3011）、ACCESS_PASSWORD（默认 rehearsal123）
 */
const BASE = process.env.BASE ?? 'http://localhost:3011';
const PASSWORD = process.env.ACCESS_PASSWORD ?? 'rehearsal123';
const phase = process.argv[2] ?? 'phase1';
const WORK_TITLE = '演练作品-可删';

let cookie = '';
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  ok ? passed++ : failed++;
}

async function api(method, pathname, body, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return res;
}

async function main() {
  // 0) health
  const health = await (await api('GET', '/api/health')).json();
  check('health.storage=ok', health?.storage === 'ok', JSON.stringify(health).slice(0, 80));

  // 1) 登录
  const login = await api('POST', '/api/auth/login', { password: PASSWORD });
  check('登录', login.ok, `status=${login.status}`);
  if (!login.ok) {
    process.exitCode = 1;
    return;
  }

  if (phase === 'phase1') {
    // 2) 写入 secrets：openai 通道指向 mock-llm（容器网络内主机名）
    const putSecrets = await api('PUT', '/api/secrets', {
      openai: { apiKey: 'mock-key', baseUrl: 'http://novel-rehearsal-mock:3100/v1' },
    });
    check('写入 secrets（openai→mock 上游）', putSecrets.ok, `status=${putSecrets.status}`);

    // 3) 建作品（presetId 是 default('') 的字符串——strictObject 拒绝 null）
    const created = await api('POST', '/api/works', {
      title: WORK_TITLE,
      mode: 'novel',
      genre: 'chuanyue',
      characterIds: [],
      worldbookIds: [],
      presetId: '',
      regexScriptIds: [],
    });
    const work = await created.json();
    check('创建作品', created.ok, `id=${work.id ?? created.status}`);
    if (!created.ok) {
      process.exitCode = 1;
      return;
    }

    // 4) SSE 生成一章（openai 通道 → mock 上游固定章节文本）
    const gen = await api('POST', '/api/llm/generate', {
      source: 'openai',
      model: 'mock-novel',
      stream: true,
      params: { temperature: 0.8, max_tokens: 2048 },
      messages: [{ role: 'user', content: '写第一章：少年与妹妹在废墟中觉醒' }],
    });
    check('生成请求发出（SSE）', gen.ok, `status=${gen.status}`);
    const raw = await gen.text();
    const texts = [...raw.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((m) =>
      JSON.parse(`"${m[1]}"`),
    );
    const full = texts.join('');
    check('流式文本非空', full.length > 100, `chars=${full.length}`);
    check('mock 章节标题解析（# 第1章）', /第\s*1\s*章|第一章/.test(full), full.slice(0, 40));

    // 5) 入库（§9.2：入库是客户端职责——以真实客户端同款 upsert 语义演练）
    const titleMatch = /^#\s*(第\s*1\s*章[^\n]*)/.exec(full);
    const message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      name: '小说家',
      content: full,
      createdAt: Date.now(),
      swipes: [full],
      swipeId: 0,
      chapter: { index: 1, title: titleMatch ? titleMatch[1].trim() : '第1章' },
      extra: { model: 'mock-novel' },
    };
    const upsert = await api('POST', `/api/works/${work.id}/messages`, message);
    check('章节幂等入库（POST messages）', upsert.ok, `status=${upsert.status}`);

    // 6) 读回验证（GET 返回 MessagesPage：{messages, hasMore?}）
    const page = await (await api('GET', `/api/works/${work.id}/messages`)).json();
    const chapters = (page?.messages ?? []).filter((m) => m.chapter);
    check('章节读回（带后处理标题）', chapters.length >= 1 && chapters[0].chapter.title.length > 0, chapters[0]?.chapter?.title ?? '');
    console.log(`\nphase1 完成：作品「${WORK_TITLE}」已入库，进入重启持久化验证（rehearsal.sh 自动执行）`);
    return;
  }

  // phase2：持久化验证
  const worksRes = await api('GET', '/api/works');
  const works = await worksRes.json();
  const found = Array.isArray(works) ? works.find((w) => w.title === WORK_TITLE) : null;
  check('重启后作品仍在（数据卷持久化）', Boolean(found), worksRes.status === 200 ? `works=${works.length}` : `status=${worksRes.status}`);
  if (found) {
    const page = await (await api('GET', `/api/works/${found.id}/messages`)).json();
    const chapters = (page?.messages ?? []).filter((m) => m.chapter);
    check('重启后章节仍在', chapters.length >= 1, `chapters=${chapters.length}`);
  }
  console.log(`\nphase2 完成：${passed} passed / ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
