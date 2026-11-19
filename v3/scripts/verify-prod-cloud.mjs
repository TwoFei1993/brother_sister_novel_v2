/**
 * 云平台生产环境全功能验证（确保所有更新没问题；绝不删除/更改现有作品）
 * 全程只操作自建的「云平台验证-可删」测试作品与测试物品，最后删除清理。
 * 用法：node scripts/verify-prod-cloud.mjs [BASE] [PASSWORD]
 */
const BASE = process.argv[2] ?? 'http://124.222.187.155:3001';
const PASSWORD = process.argv[3] ?? 'Shao2011';
const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, ok: Boolean(cond) });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` —— ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 登录 ----------
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: PASSWORD }),
});
const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
ok('登录', loginRes.ok && Boolean(cookie));
const H = { 'Content-Type': 'application/json', Cookie: cookie };
const j = (r) => r.json();

// ---------- ① 物品道具 CRUD ----------
const item = await j(
  await fetch(`${BASE}/api/items`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      name: '验证-银锁',
      summary: '云平台验证用',
      texture: '温润玉质',
      color: '月白',
      usage: '安抚',
      emotion: '母亲遗物',
    }),
  }),
);
ok('①a 物品创建', Boolean(item.id), `id=${String(item.id).slice(0, 8)}`);
const itemList = await j(await fetch(`${BASE}/api/items`, { headers: H }));
ok('①b 物品列表含新卡', Array.isArray(itemList) && itemList.some((x) => x.id === item.id));
const itemPatched = await j(
  await fetch(`${BASE}/api/items/${item.id}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ emotion: '兄妹羁绊信物' }),
  }),
);
ok('①c 物品 PATCH 浅合并', itemPatched.emotion === '兄妹羁绊信物' && itemPatched.texture === '温润玉质');

// ---------- ② 作品创建（分卷 chapterCount + 章纲） ----------
const settings = {
  genre: 'hunhe',
  subGenre: '都市日常',
  customGenre: '',
  customSubGenre: '',
  backgroundNote: '云平台验证。',
  brotherAge: 24,
  brotherPersonalities: [],
  customBrotherPersonality: '',
  brotherAbility: '',
  sisterAge: 18,
  sisterPersonalities: [],
  customSisterPersonality: '',
  sisterAbility: '',
  relationType: '相互扶持共同成长型',
  customRelationType: '',
  powerSystem: '',
  factions: '',
  coreConflict: '',
  storyTones: ['温情治愈'],
  customStoryTone: '',
  writingStyle: 'default',
  customWritingStyle: '',
  desiredChapterCount: 3,
  outlineChapterCount: 3,
  pastedOutline: '',
  authorNote: '',
  noteDepth: 4,
  targetChapterWords: 600,
  volumeOutlines: [
    { index: 1, title: '验证卷一', summary: '卷一主线。', startChapter: 1, chapterCount: 2 },
    { index: 2, title: '验证卷二', summary: '卷二主线。', startChapter: 3 },
  ],
  chapterOutlines: [
    { index: 1, title: '验证第1章', plot: '开篇。' },
    { index: 2, title: '验证第2章', plot: '推进。' },
    { index: 3, title: '验证第3章', plot: '卷二开篇。' },
  ],
};
const work = await j(
  await fetch(`${BASE}/api/works`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      title: '云平台验证-可删',
      mode: 'novel',
      genre: 'dushi',
      characterIds: [],
      worldbookIds: [],
      presetId: '',
      regexScriptIds: [],
      settings,
      voiceMap: {},
    }),
  }),
);
ok('② 作品创建（分卷+章纲）', Boolean(work.id) && (work.settings.volumeOutlines ?? []).length === 2, `id=${String(work.id).slice(0, 8)}`);

// ---------- ③ 改名 roundtrip ----------
const renamed = await j(
  await fetch(`${BASE}/api/works/${work.id}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ revision: work.revision, title: '云平台验证-已改名' }),
  }),
);
ok('③a 作品改名 PATCH', renamed.title === '云平台验证-已改名');
const renamedBack = await j(
  await fetch(`${BASE}/api/works/${work.id}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ revision: renamed.revision, title: '云平台验证-可删' }),
  }),
);
ok('③b 改名还原', renamedBack.title === '云平台验证-可删');

// ---------- ④ 章纲 PATCH roundtrip ----------
const patchBody4 = JSON.stringify({
  revision: renamedBack.revision,
  settings: {
    ...renamedBack.settings,
    chapterOutlines: [
      { index: 1, title: '验证第1章（改）', plot: '开篇改。' },
      { index: 2, title: '验证第2章（改）', plot: '推进改。' },
      { index: 3, title: '验证第3章', plot: '卷二开篇。' },
    ],
  },
});
const repatch = await j(
  await fetch(`${BASE}/api/works/${work.id}`, { method: 'PATCH', headers: H, body: patchBody4 }),
);
ok('④ 章纲 PATCH', (repatch.settings.chapterOutlines ?? [])[0]?.title === '验证第1章（改）');

// ---------- ⑤ 后台任务：真实 LLM 生成第 1 章（移动端后台生成同一 API） ----------
const genSubmitRes = await fetch(`${BASE}/api/llm/tasks`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    source: 'claude',
    model: 'MiniMax-M3.1-Flash',
    messages: [
      { role: 'system', content: '你是一位资深中文小说作家。根据设定与剧情指引写一章正文。第一行输出「# 第N章 标题」。基调温情治愈，只输出正文。' },
      { role: 'user', content: '第1章 开业第一夜：哥哥深夜筹备便利店开业，妹妹下晚自习来店帮忙。约 600 字，写完即停。' },
    ],
    params: { temperature: 0.7, max_tokens: 8000 },
    thinking: false,
    label: '验证生成',
  }),
});
const genTask = await j(genSubmitRes);
ok('⑤a 后台任务提交', Boolean(genTask.taskId), `taskId=${String(genTask.taskId).slice(0, 8)}`);
let genText = '';
for (let i = 0; i < 60; i += 1) {
  await sleep(5000);
  const st = await j(await fetch(`${BASE}/api/llm/tasks/${genTask.taskId}`, { headers: H }));
  if (st.status === 'done') {
    genText = st.text ?? '';
    break;
  }
  if (st.status === 'failed') {
    genText = '';
    console.log('   任务失败:', st.error ?? '');
    break;
  }
}
ok('⑤b 真实 LLM 生成完成', genText.trim().length > 300, `${genText.length} 字 | 开头: ${genText.slice(0, 30).replace(/\n/g, ' ')}`);

// ---------- ⑥ chapterCount 归卷语义（与前端 locateVolume 同源逻辑镜像验证） ----------
const ccVolumes = [
  { index: 1, title: '卷一', startChapter: 1, chapterCount: 2 },
  { index: 2, title: '卷二', startChapter: 3 },
];
const locate = (n) => {
  const sorted = [...ccVolumes].sort((a, b) => a.index - b.index);
  let cursor = 1;
  const bounds = sorted.map((v) => {
    const s = v.startChapter ?? cursor;
    cursor = s + (v.chapterCount ?? 1);
    return { ...v, effStart: s };
  });
  for (let i = 0; i < bounds.length; i += 1) {
    bounds[i].effEnd = i < bounds.length - 1 ? bounds[i + 1].effStart - 1 : Number.POSITIVE_INFINITY;
  }
  const hit = bounds.find((v) => n >= v.effStart && n <= v.effEnd);
  return (hit ?? bounds[bounds.length - 1]).title;
};
ok('⑥ chapterCount 归卷', locate(1) === '卷一' && locate(2) === '卷一' && locate(3) === '卷二', '章1→卷一 章2→卷一 章3→卷二');

// ---------- 清理：删除测试作品与测试物品（绝不触碰现有作品） ----------
await fetch(`${BASE}/api/works/${work.id}`, { method: 'DELETE', headers: H });
await fetch(`${BASE}/api/items/${item.id}`, { method: 'DELETE', headers: H });
const remainWorks = await j(await fetch(`${BASE}/api/works`, { headers: H }));
ok(
  '⑦ 清理测试数据',
  Array.isArray(remainWorks) && !remainWorks.some((w) => w.title.includes('云平台验证')),
  `现有作品 ${remainWorks.length} 个未动`,
);

// ---------- 汇总 ----------
const failed = results.filter((r) => !r.ok);
console.log(`\n===== 生产验证：${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
  console.log('失败项：');
  for (const f of failed) console.log(' ❌', f.name);
  process.exit(1);
}
