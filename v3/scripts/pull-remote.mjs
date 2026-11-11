#!/usr/bin/env node
/**
 * 从线上（生产站）拉取全部作品到本地（用户需求：线上书搬到本地环境）
 *
 * 用法：REMOTE=http://124.222.187.155:3001 PASSWORD=Shao2011 node scripts/pull-remote.mjs
 * 流程：登录 → 列作品 → 逐部拉 work.json + messages + duanju/project.json → 本地 data/works 重建。
 * 已存在同 id 的本地作品跳过（不覆盖本地）；拉完重启不需要（works 列表实时读目录）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REMOTE = (process.env.REMOTE ?? 'http://124.222.187.155:3001').replace(/\/$/, '');
const PASSWORD = process.env.PASSWORD ?? 'Shao2011';
const WORKS_DIR = resolve(process.cwd(), 'data/works');

async function api(path, opts = {}, cookie = '') {
  const res = await fetch(`${REMOTE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

// 1. 登录
const loginRes = await fetch(`${REMOTE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: PASSWORD }),
});
if (!loginRes.ok) throw new Error(`登录失败 HTTP ${loginRes.status}`);
const setCookie = loginRes.headers.get('set-cookie') ?? '';
const cookie = setCookie.split(';')[0];
console.log('✅ 登录成功');

// 2. 列作品
const works = await api('/api/works', {}, cookie);
console.log(`线上共 ${works.length} 部作品`);

let pulled = 0;
let skipped = 0;
const failed = [];

for (const w of works) {
  const dir = join(WORKS_DIR, w.id);
  if (existsSync(join(dir, 'work.json'))) {
    skipped += 1;
    continue; // 本地已存在同 id（不覆盖本地）
  }
  try {
    const full = await api(`/api/works/${w.id}`, {}, cookie);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'work.json'), JSON.stringify(full, null, 2), 'utf8');

    // 消息流（tail=1000；线上作品规模远小于上限）
    if (full.mode !== 'duanju') {
      const msgs = await api(`/api/works/${w.id}/messages?tail=1000`, {}, cookie);
      const lines = (msgs.messages ?? []).map((m) => JSON.stringify(m)).join('\n');
      writeFileSync(join(dir, 'messages.jsonl'), lines ? lines + '\n' : '', 'utf8');
    } else {
      // duanju：project.json 一并拉（剧本/角色/场景/分镜全在里面）
      try {
        const project = await api(`/api/works/${w.id}/duanju`, {}, cookie);
        mkdirSync(join(dir, 'duanju'), { recursive: true });
        writeFileSync(join(dir, 'duanju', 'project.json'), JSON.stringify(project, null, 2), 'utf8');
      } catch (e) {
        console.log(`  ⚠ ${w.title}: project.json 拉取失败 ${e.message}`);
      }
    }
    pulled += 1;
    console.log(`  ✅ [${full.mode}] ${full.title}`);
  } catch (e) {
    failed.push({ title: w.title, err: e.message });
    console.log(`  ❌ ${w.title}: ${e.message}`);
  }
}

console.log(`\n完成：拉取 ${pulled} 部 · 跳过（本地已有）${skipped} 部 · 失败 ${failed.length} 部`);
if (failed.length > 0) for (const f of failed) console.log(`  失败: ${f.title} — ${f.err}`);
