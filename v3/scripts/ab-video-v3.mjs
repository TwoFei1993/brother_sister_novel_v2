#!/usr/bin/env node
/**
 * A/B 第三轮：v3 最新链（看片结论驱动——中段突然/台词含糊两个问题）
 *
 * ① v3 提示词 = App buildLocalVideoPrompt 最新形态（drama-skills 六项：说话人绑定+开口停顿+
 *    闭嘴声明+字幕禁令+non_diegetic_music N/A+lockPhrase）——A/B v2 快照落后两代
 * ② 治「中段突然」：每段末尾加交接半句（前段末动作=后段首动作的中间态）——段间连续性显式化
 * ③ 过 AICG3D 优化器在线细化（六段式时间线展开，中段动作节拍由 M3.1 补全）——失败回退手写 v3
 *
 * 产物：D:\短剧生成\测试\ab-视频提示词v1v2对比\v3-6s.mp4（+ v3-prompt.txt 两版对比）
 * 用法：node scripts/ab-video-v3.mjs   （引擎在线 + 优化器已配 MiniMax 通道）
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8188';
const DIR = 'D:/短剧生成/测试/ab-视频提示词v1v2对比';
const SEED = 20261114;

const src = readFileSync(new URL('../client/src/features/duanju/lib/comfyDefaultWorkflow.ts', import.meta.url), 'utf8');
const FLF2V = src.match(/HYPERFLOW_FLF2V_DEFAULT_WORKFLOW = `([\s\S]*?)`;/)[1];
function inject(text, ph) {
  let t = text;
  for (const [k, v] of Object.entries(ph)) t = t.split(k).join(JSON.stringify(String(v)).slice(1, -1));
  return JSON.parse(t);
}
async function uploadImage(blob, name) {
  const form = new FormData();
  form.append('image', new File([blob], name, { type: 'image/png' }));
  form.append('overwrite', 'true');
  const j = await (await fetch(`${BASE}/upload/image`, { method: 'POST', body: form })).json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

// 手写 v3（App buildLocalVideoPrompt 最新形态 + 段末交接句治「中段突然」）
const V3 = `[Continuity locks] Li Wei: shoulder-length black hair slightly wet, beige trench coat, dark grey turtleneck, straight trousers, black ankle boots, old mechanical watch on left wrist — keep every item verbatim in all frames.
[Character spec] 李薇（28岁女记者，黑色齐肩发微湿贴颊，深棕色瞳，眉骨清晰下颌线紧；身高165cm；米色长风衣配深灰高领与直筒裤，黑色短靴；左腕旧机械表） — appearance must stay identical to the reference frames throughout.
How the reference pictures align: picture 1 matches the opening frame exactly at 0.0s, picture 2 matches the closing frame exactly at 6.6s.
[0.0s-1.7s] 李薇在昏黄路灯下的湿滑巷口猛地转身，风衣下摆甩起水珠；她眉头紧锁张嘴嘶吼，握手机的手指节泛白；逆光剪影，霓虹在湿地面映出冷蓝反光 — precisely match the opening state; by the end of this beat her weight has fully shifted onto the leading foot.
[1.7s-3.3s] 李薇向前逼近一步，雨水顺着发梢滴落，手机屏幕的光照亮她泛红的眼眶；她咬紧下唇，胸口剧烈起伏，将质问未问 — the aggression softens into exhaustion as her free hand begins to rise.
[3.3s-5.0s] 李薇伸手抓住对方衣袖用力一扯，两人距离骤然拉近；雨水在两人之间溅起细碎水花，霓虹灯在积水中碎成光斑 — her grip slowly releases as her knees start to give way.
[5.0s-6.6s] 李薇背靠砖墙缓缓滑坐在地，手机滑落到积水里屏幕朝上；她仰头靠墙，泪水和雨水混在一起，嘴唇微微颤抖 — arrive exactly at the closing frame state.
[Camera] slow dolly-in toward the subject; 画面中央.
李薇 (S1), on-screen, mouth visibly articulating the words, speaks after a brief natural pause from the opening state: <d>[Chinese] 你到底隐瞒了什么！</d>
[Text] The frame stays free of any captions, subtitles or text overlays at all times.
overall_soundscape: ambient rain on pavement, distant thunder, footsteps and cloth movement; her shout is emotionally raw yet the vocal rendering stays clear and intelligible.
non_diegetic_music: N/A`;

/** 优化器在线细化（失败回退手写 v3——A/B 不因插件挂掉中断） */
async function optimize(prompt) {
  try {
    const r = await fetch(`${BASE}/aicg3d/goohai/minimax-h3/prompt-optimizer/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ prompt, task: 'fl2va', duration: 6.6, request_id: `ab3-${Date.now()}` }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) return { text: prompt, source: 'fallback-http' };
    const j = await r.json();
    return typeof j.prompt === 'string' && j.prompt.trim().length > 200
      ? { text: j.prompt, source: 'optimized' }
      : { text: prompt, source: 'fallback-empty' };
  } catch {
    return { text: prompt, source: 'fallback-error' };
  }
}

const f1 = await uploadImage(new Blob([readFileSync(`${DIR}/F1-起势.png`)]), 'ab-f1.png');
const f4 = await uploadImage(new Blob([readFileSync(`${DIR}/F4-落势.png`)]), 'ab-f4.png');

console.log('[1/3] 优化器在线细化（M3.1 六段式展开中段节拍）…');
const opt = await optimize(V3);
console.log(`  来源: ${opt.source}${opt.source === 'optimized' ? '（长度 ' + opt.text.length + '）' : '——用手写 v3'}`);
writeFileSync(`${DIR}/v3-prompt-手写.txt`, V3);
writeFileSync(`${DIR}/v3-prompt-实际.txt`, `${opt.source}\n\n${opt.text}`);

console.log('[2/3] flf2v 6.6s 生成（158帧，约 4-13 分钟）…');
const wf = inject(FLF2V, { '<<FRAME>>': f1, '<<LAST_FRAME>>': f4, '<<PROMPT>>': opt.text, '<<LENGTH>>': 158, '<<SEED>>': SEED });
const { prompt_id } = await (await fetch(`${BASE}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'ab-v3' }) })).json();
const t0 = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const h = await (await fetch(`${BASE}/history/${prompt_id}`)).json();
  const e = h[prompt_id];
  if (e?.status?.completed) {
    for (const node of Object.values(e.outputs)) {
      const img = node?.images?.[0] ?? node?.gifs?.[0];
      if (img) {
        const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
        const blob = await (await fetch(`${BASE}/view?${q}`)).blob();
        writeFileSync(`${DIR}/v3-6s.mp4`, Buffer.from(await blob.arrayBuffer()));
        console.log(`[3/3] ✓ v3 完成（${Math.round((Date.now() - t0) / 1000)}s）→ ${DIR}\\v3-6s.mp4`);
        process.exit(0);
      }
    }
  }
  if (e && !e.status?.completed && e.status?.status_str === 'error') { console.error('执行失败'); process.exit(1); }
  if (Date.now() - t0 > 20 * 60_000) { console.error('20 分钟超时'); process.exit(1); }
}
