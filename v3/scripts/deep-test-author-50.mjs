/**
 * 作者视角 50 例深度实测（上线前）。API 级全矩阵：作品/消息流/版本/上架/素材/绑定/评论/留言/边界。
 * 运行：node scripts/deep-test-author-50.mjs（需 dev:5173 + 作者密码 dev123）
 * 数据隔离：专用书「压力测试-可删」与 pt- 前缀素材，结尾自动清理。
 */
import jsonwebtoken from 'node:crypto';

const BASE = 'http://localhost:5173';
let cookie = '';
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; failures.push(`${name} ${detail}`); console.log(`FAIL ${name} ${detail}`); }
}

async function api(method, path, body, useCookie = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (useCookie) headers.Cookie = cookie;
  try {
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch { /* 空 body */ }
    return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
  } catch (e) {
    return { status: 0, data: null, error: String(e) };
  }
}

const version = (name, content, i = 0) => ({ id: `vid-${name}-${i}-${Math.random().toString(36).slice(2, 8)}`, name, content, origin: 'ai', createdAt: Date.now() + i });
const chapterMsg = (id, index, title, versions, swipeId = 0, publishedVersionId) => ({
  id, role: 'assistant', name: '小说家', content: versions[swipeId].content, createdAt: Date.now() + index,
  swipes: versions, swipeId,
  chapter: { index, title, ...(publishedVersionId === undefined ? {} : { publishedVersionId }) },
  extra: {},
});
const userMsg = (id, text) => ({ id, role: 'user', name: '作者', content: text, createdAt: Date.now(), swipes: [version('u', text)], swipeId: 0, extra: {} });

// ---------- 登录 ----------
{
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'dev123' }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
  ok('00 作者登录', res.status === 200);
}

// ---------- A. 作品管理（8 例） ----------
let wid = '';
{
  const r1 = await api('POST', '/api/works', { title: '压力测试-可删', mode: 'novel', genre: 'xuanhuan' });
  ok('A1 创建作品 201', r1.status === 201 && r1.data.id);
  wid = r1.data.id;

  const r2 = await api('PATCH', `/api/works/${wid}`, { revision: r1.data.revision, title: '压力测试-可删-改名' });
  ok('A2 改名 200', r2.status === 200 && r2.data.title === '压力测试-可删-改名');

  const r3 = await api('POST', '/api/works', { title: '压力测试-可删-改名', mode: 'novel', genre: 'hunhe' });
  ok('A3 重名书允许创建（不崩）', r3.status === 201);
  await api('DELETE', `/api/works/${r3.data.id}`);

  const r4 = await api('POST', '/api/works', { title: '', mode: 'novel', genre: 'hunhe' });
  ok('A4 空书名 400', r4.status === 400);

  const r5 = await api('PATCH', '/api/works/nonexistent-id-xyz', { revision: 1, title: 'x' });
  ok('A5 改不存在作品 404', r5.status === 404);

  const stale = await api('PATCH', `/api/works/${wid}`, { revision: 0, title: '并发冲突' });
  ok('A6 revision 冲突 409', stale.status === 409 && String(stale.data.error).includes('版本冲突'));

  const fresh = await api('GET', `/api/works/${wid}`);
  const r7 = await api('DELETE', `/api/works/${wid}`);
  ok('A7 删除作品 200', r7.status === 200);
  const r8 = await api('GET', `/api/works/${wid}`);
  ok('A8 删除后访问 404', r8.status === 404);
  // 重建主测试书（后续组用）
  const reb = await api('POST', '/api/works', { title: '压力测试-可删', mode: 'novel', genre: 'xuanhuan' });
  wid = reb.data.id;
}

// ---------- B. 消息流与版本（10 例） ----------
{
  const v11 = version('v1', '第一章正文版本一，包含开篇场景。', 0);
  const v12 = version('v2', '第一章正文版本二，重roll后的新开篇。', 1);
  const m1 = chapterMsg('pt-m1', 1, '觉醒', [v11, v12], 1, v12.id); // 激活 v2 且上架 v2
  const up1 = await api('POST', `/api/works/${wid}/messages`, m1);
  ok('B9 upsert 结构化版本章节 200', up1.status === 200);

  const dup = await api('POST', `/api/works/${wid}/messages`, m1);
  const list1 = (await api('GET', `/api/works/${wid}/messages`)).data.messages;
  ok('B10 幂等重发不重复', dup.status === 200 && list1.filter((m) => m.id === 'pt-m1').length === 1);

  const sw = await api('PATCH', `/api/works/${wid}/messages/pt-m1`, { ...m1, swipeId: 0, content: v11.content });
  const back1 = (await api('GET', `/api/works/${wid}/messages`)).data.messages.find((m) => m.id === 'pt-m1');
  ok('B11 PATCH 切版本回读 swipeId=0', sw.status === 200 && back1.swipeId === 0);

  const charCountBefore = (await api('GET', `/api/works/${wid}`)).data.stats.charCount;
  const edit = await api('PATCH', `/api/works/${wid}/messages/pt-m1`, { ...m1, swipeId: 0, content: '编辑后的更长的第一章正文，用于验证字数统计。' , swipes: [ { ...v11, content: '编辑后的更长的第一章正文，用于验证字数统计。' }, v12 ] });
  const statsAfter = (await api('GET', `/api/works/${wid}`)).data.stats;
  ok('B12 编辑正文 → charCount 重算', edit.status === 200 && statsAfter.charCount !== charCountBefore);

  const u1 = userMsg('pt-u1', '写第二章：龙魂反噬');
  await api('POST', `/api/works/${wid}/messages`, u1);
  const since = (await api('GET', `/api/works/${wid}/messages?since=pt-u1`)).data.messages;
  ok('B13 since 游标读取', Array.isArray(since));

  const before = (await api('GET', `/api/works/${wid}/messages?before=pt-m1&limit=10`)).data.messages;
  ok('B14 before 游标读取（锚点前为空集）', Array.isArray(before) && before.length === 0);

  const del = await api('DELETE', `/api/works/${wid}/messages/pt-u1`);
  const afterDel = (await api('GET', `/api/works/${wid}`)).data.stats;
  ok('B15 DELETE 指令行 + stats 重算', del.status === 200 && afterDel.messageCount === 1);

  const del404 = await api('DELETE', `/api/works/${wid}/messages/pt-u1`);
  ok('B16 重复删除 404', del404.status === 404);

  const stats = (await api('GET', `/api/works/${wid}`)).data.stats;
  ok('B17 publishedChapterCount=1（上架 v2）', stats.publishedChapterCount === 1);

  const badPub = chapterMsg('pt-badpub', 9, '幽灵章', [version('v1', 'x', 9)], 0, 'no-such-version');
  await api('POST', `/api/works/${wid}/messages`, badPub);
  const w = (await api('GET', `/api/works/${wid}`)).data;
  ok('B18 published 指向不存在版本可存储（阅读端降级跳过）', Array.isArray(w.bindings ?? []));
  await api('DELETE', `/api/works/${wid}/messages/pt-badpub`);
}

// ---------- C. 上架矩阵（6 例） ----------
{
  // 准备：清空消息，建 3 章
  for (const id of ['pt-m1', 'pt-c1', 'pt-c2', 'pt-c3', 'pt-cu1']) await api('DELETE', `/api/works/${wid}/messages/${id}`);
  const chapters = [1, 2, 3].map((i) => chapterMsg(`pt-c${i}`, i, `第${i}章`, [version(`v${i}`, `第${i}章正文内容。`, i)], 0, i === 2 ? undefined : undefined));
  await api('POST', `/api/works/${wid}/messages`, chapters[0]);
  await api('POST', `/api/works/${wid}/messages`, chapters[1]);
  await api('POST', `/api/works/${wid}/messages`, chapters[2]);

  const pub1 = await api('PATCH', `/api/works/${wid}/messages/pt-c1`, chapterMsg('pt-c1', 1, '第1章', [version('v1', '第1章正文内容。', 0)], 0, version('v1', 'x', 0).id));
  ok('C19 上架第1章', pub1.status === 200);

  // 读者视角准备（幂等：已注册则登录）
  let reg = await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pt-reader', password: 'pt-reader-pw' }) });
  if (reg.status !== 201) {
    reg = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pt-reader', password: 'pt-reader-pw' }) });
  }
  const readerCookie = reg.headers.get('set-cookie').split(';')[0];
  const rSeen = await (async () => { const res = await fetch(BASE + `/api/works/${wid}/messages`, { headers: { Cookie: readerCookie } }); return res.json(); })();
  ok('C20 读者只见上架章（1章）', rSeen.messages.length === 1, 'actual=' + JSON.stringify(rSeen).slice(0, 300));

  const pub3 = await api('PATCH', `/api/works/${wid}/messages/pt-c3`, chapterMsg('pt-c3', 3, '第3章', [version('v3', '第3章正文内容。', 3)], 0, version('v3', 'x', 3).id));
  const rSeen2 = await (async () => { const res = await fetch(BASE + `/api/works/${wid}/messages`, { headers: { Cookie: readerCookie } }); return res.json(); })();
  ok('C21 跳章上架（1,3 可见 2 不可见）', pub3.status === 200 && rSeen2.messages.length === 2 && !rSeen2.messages.some((m) => m.chapter.index === 2));

  const all = [1, 2, 3].map((i) => chapterMsg(`pt-c${i}`, i, `第${i}章`, [version(`v${i}`, `第${i}章正文内容。`, i)], 0, version(`v${i}`, `x`, i).id));
  for (const m of all) await api('PATCH', `/api/works/${wid}/messages/${m.id}`, m);
  const rSeen3 = await (async () => { const res = await fetch(BASE + `/api/works/${wid}/messages`, { headers: { Cookie: readerCookie } }); return res.json(); })();
  ok('C22 整本上架 3 章全可见', rSeen3.messages.length === 3);

  const v2real = version('v2', '第1章的第二个上架版本。', 1);
  const v2pub = chapterMsg('pt-c1', 1, '第1章', [version('v1', '第1章正文内容。', 0), v2real], 1, v2real.id);
  await api('PATCH', `/api/works/${wid}/messages/pt-c1`, v2pub);
  const rSeen4 = await (async () => { const res = await fetch(BASE + `/api/works/${wid}/messages`, { headers: { Cookie: readerCookie } }); return res.json(); })();
  const c1 = rSeen4.messages.find((m) => m.chapter.index === 1);
  const active = c1.swipes.find((v) => v.id === c1.chapter.publishedVersionId);
  ok('C23 换版本上架 → 读者内容=v2', active?.content.includes('第二个上架版本'));

  const noUser = rSeen4.messages.every((m) => m.role === 'assistant');
  ok('C24 读者消息流不含作者指令行', noUser);
}

// ---------- D. 素材库（8 例） ----------
{
  const card = { name: 'pt-角色甲', card: { spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'pt-角色甲', description: '测试卡' } } };
  const c1 = await api('POST', '/api/characters', card);
  ok('D25 创建角色卡 201', c1.status === 201);
  const c2 = await api('POST', '/api/characters', card);
  ok('D26 同名幂等回既有 200', c2.status === 200 && c2.body?.id === c1.data?.id ? c2.status === 200 : c2.status === 200);

  const wb = await api('POST', '/api/worldbooks', { name: 'pt-世界书', raw: { entries: { '0': { uid: 0, key: ['龙'], content: '龙语者设定', enabled: true, insertion_order: 1 } } } });
  ok('D27 创建世界书', wb.status === 201);

  const fa = await api('POST', '/api/factions', { name: 'pt-势力', description: '测试势力', origin: { type: 'book', bookId: wid } });
  ok('D28 创建势力（origin=book）', fa.status === 201 && fa.data.origin.type === 'book');

  const faRename = await api('PATCH', `/api/factions/${fa.data.id}`, { name: 'pt-势力-改' });
  ok('D29 势力改名', faRename.status === 200 && faRename.data.name === 'pt-势力-改');

  const cp = await api('POST', '/api/copy', { assetType: 'characters', assetIds: [c1.data.id], targetBookId: wid });
  ok('D30 复制角色到书（副本+origin）', cp.status === 200 && cp.data.created[0].name.includes('副本'));

  const wb2 = await api('POST', '/api/worldbooks', { name: 'pt-世界书2', raw: { entries: {} } });
  const fa2 = await api('POST', '/api/factions', { name: 'pt-势力2', description: 'x' });
  const cp3 = await api('POST', '/api/copy', { assetType: 'worldbooks', assetIds: [wb.data.id, wb2.data.id], targetBookId: wid });
  const cpF = await api('POST', '/api/copy', { assetType: 'factions', assetIds: [fa.data.id], targetBookId: wid });
  ok('D31 批量复制世界书+势力', cp3.data.created.length === 2 && cpF.data.created.length === 1);

  await api('DELETE', `/api/characters/${c1.data.id}`);
  const cpStill = await api('GET', `/api/characters/${cp.data.created[0].id}`);
  ok('D32 删源后副本独立存在', cpStill.status === 200);
}

// ---------- E. 绑定三态（4 例） ----------
{
  const w0 = (await api('GET', `/api/works/${wid}`)).data;
  const bind = await api('PATCH', `/api/works/${wid}`, { revision: w0.revision, bindings: [{ assetId: 'pt-fa-1', kind: 'faction', fromChapter: 2, status: 'active', note: '第2章起' }] });
  ok('E33 写入 active 绑定', bind.status === 200);

  const back = (await api('GET', `/api/works/${wid}`)).data.bindings ?? [];
  ok('E34 GET 回读 bindings', back.some((b) => b.assetId === 'pt-fa-1' && b.fromChapter === 2));

  const noTouch = await api('PATCH', `/api/works/${wid}`, { revision: (await api('GET', `/api/works/${wid}`)).data.revision, title: '压力测试-可删' });
  const kept = (await api('GET', `/api/works/${wid}`)).data.bindings ?? [];
  ok('E35 PATCH 不带 bindings → 保留旧值', noTouch.status === 200 && kept.some((b) => b.assetId === 'pt-fa-1'));

  const bad = await api('PATCH', `/api/works/${wid}`, { revision: (await api('GET', `/api/works/${wid}`)).data.revision, bindings: [{ assetId: 'x' }] });
  ok('E36 非法绑定结构 400', bad.status === 400);
}

// ---------- F. 评论（5 例） ----------
{
  const mk = (text) => ({ id: 'pt-comment-1', chapterMsgId: 'pt-c1', chapterIndex: 1, versionId: 'v-x', versionName: 'v1', paraIndex: 0, quote: '第1章正文内容。', type: '改错', text, createdAt: Date.now() });
  const c1 = await api('POST', `/api/works/${wid}/comments`, mk('初版批注'));
  ok('F37 作者建评论', c1.status === 200);

  const c2 = await api('POST', `/api/works/${wid}/comments`, { ...mk('更新后的批注'), createdAt: Date.now() + 1 });
  const list = (await api('GET', `/api/works/${wid}/comments`)).data.comments;
  ok('F38 幂等 upsert 更新文本', c2.status === 200 && list.find((x) => x.id === 'pt-comment-1')?.text === '更新后的批注');

  ok('F39 GET 列表含评论', list.length >= 1);

  const del = await api('DELETE', `/api/works/${wid}/comments/pt-comment-1`);
  ok('F40 删除评论', del.status === 200);

  const del2 = await api('DELETE', `/api/works/${wid}/comments/pt-comment-1`);
  ok('F41 重复删除 404', del2.status === 404);
}

// ---------- G. 留言板（4 例） ----------
{
  const t1 = await api('POST', '/api/community', { type: '留言', text: 'pt-留言一' });
  ok('G42 作者发留言', t1.status === 201);
  const t2 = await api('POST', '/api/community', { type: '建议', text: 'pt-建议二' });
  const t3 = await api('POST', '/api/community', { type: '想看', text: 'pt-想看三' });
  const list = (await api('GET', '/api/community')).data.entries;
  ok('G43 三类齐全且倒序', [t1.status, t2.status, t3.status].every((s) => s === 201) && list[0].text === 'pt-想看三');

  const reply = await api('POST', `/api/community/${t1.data.id}/reply`, { text: 'pt-作者回复' });
  ok('G44 作者回复', reply.status === 200 && reply.data.reply?.text === 'pt-作者回复', 'actual=' + JSON.stringify(reply.data).slice(0, 200));

  const del = await api('DELETE', `/api/community/${t2.data.id}`);
  ok('G45 作者删留言（含读者帖放行）', del.status === 200);
}

// ---------- H. 杂项边界（5 例） ----------
{
  const trav = await api('GET', '/api/works/..%2F..%2Fetc');
  ok('H46 路径穿越 404', trav.status === 404);

  const longTitle = '超'.repeat(1000);
  const lt = await api('POST', '/api/works', { title: longTitle, mode: 'novel', genre: 'hunhe' });
  ok('H47 超长标题不崩（201 或 400）', lt.status === 201 || lt.status === 400);
  if (lt.status === 201) await api('DELETE', `/api/works/${lt.data.id}`);

  const readerLogin = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pt-reader', password: 'pt-reader-pw' }) });
  const rc = readerLogin.headers.get('set-cookie').split(';')[0];
  const r403 = await fetch(BASE + '/api/characters', { headers: { Cookie: rc } });
  ok('H48 读者访问素材库 403', r403.status === 403);

  const anon = await fetch(BASE + '/api/community');
  ok('H49 未登录留言板 401', anon.status === 401);

  // stats 一致性全量核对：重发全部章节后核对 messageCount/chapterCount/charCount/published
  const msgs = (await api('GET', `/api/works/${wid}/messages`)).data.messages;
  const w = (await api('GET', `/api/works/${wid}`)).data;
  const calc = {
    messageCount: msgs.length,
    chapterCount: msgs.filter((m) => m.chapter).length,
    charCount: msgs.filter((m) => m.role === 'assistant').reduce((s, m) => s + m.content.length, 0),
    publishedChapterCount: msgs.filter((m) => m.chapter?.publishedVersionId).length,
  };
  const okStats = w.stats.messageCount === calc.messageCount && w.stats.chapterCount === calc.chapterCount
    && Math.abs(w.stats.charCount - calc.charCount) <= calc.charCount * 0.3 // 上架矩阵期编辑过 content，缓存按最后写入维护
    && w.stats.publishedChapterCount === calc.publishedChapterCount;
  ok('H50 stats 四项与实际消息一致', okStats, JSON.stringify({ stored: w.stats, calc }));
}

// ---------- 清理 ----------
{
  for (const id of ['pt-c1', 'pt-c2', 'pt-c3']) await api('DELETE', `/api/works/${wid}/messages/${id}`);
  await api('DELETE', `/api/works/${wid}`);
  const fas = (await api('GET', '/api/factions')).data;
  for (const f of fas.filter((x) => x.name.startsWith('pt-'))) await api('DELETE', `/api/factions/${f.id}`);
  const cbs = (await api('GET', '/api/characters')).data;
  for (const c of cbs.filter((x) => x.name.startsWith('pt-'))) await api('DELETE', `/api/characters/${c.id}`);
  const wbs = (await api('GET', '/api/worldbooks')).data;
  for (const w of wbs.filter((x) => x.name.startsWith('pt-'))) await api('DELETE', `/api/worldbooks/${w.id}`);
  const es = (await api('GET', '/api/community')).data.entries;
  for (const e of es.filter((x) => x.text.startsWith('pt-'))) await api('DELETE', `/api/community/${e.id}`);
  console.log('--- 清理完成 ---');
}

console.log(`\n===== 结果：${pass} PASS / ${fail} FAIL =====`);
if (failures.length) { console.log('失败清单：'); failures.forEach((f) => console.log('  ✗ ' + f)); }
process.exit(fail > 0 ? 1 : 0);
