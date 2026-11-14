#!/usr/bin/env node
/** A/B 补跑：仅生成 v2 时间轴版（首尾帧复用 logs/ab-test/F1/F4，v1 已完成） */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = 'http://127.0.0.1:8188';
const DIR = resolve('logs/ab-test');
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

const V2 = `[Character spec] 李薇（28岁女记者，黑色齐肩发微湿贴颊，深棕色瞳，眉骨清晰下颌线紧；身高165cm；米色长风衣配深灰高领与直筒裤，黑色短靴；左腕旧机械表） — appearance must stay identical to the reference frames throughout.
How the reference pictures align: picture 1 matches the opening frame exactly at 0.0s, picture 2 matches the closing frame exactly at 6.6s.
[0.0s-1.7s] 李薇在昏黄路灯下的湿滑巷口猛地转身，风衣下摆甩起水珠；她眉头紧锁张嘴嘶吼，握手机的手指节泛白；逆光剪影，霓虹在湿地面映出冷蓝反光 — precisely match the opening state
[1.7s-3.3s] 李薇向前逼近一步，雨水顺着发梢滴落，手机屏幕的光照亮她泛红的眼眶；她咬紧下唇，胸口剧烈起伏，将质问未问
[3.3s-5.0s] 李薇伸手抓住对方衣袖用力一扯，两人距离骤然拉近；雨水在两人之间溅起细碎水花，霓虹灯在积水中碎成光斑
[5.0s-6.6s] 李薇背靠砖墙缓缓滑坐在地，手机滑落到积水里屏幕朝上；她仰头靠墙，泪水和雨水混在一起，嘴唇微微颤抖 — arrive exactly at the closing frame state
[Camera] slow dolly-in toward the subject; 画面中央.
<d>[Chinese] 你到底隐瞒了什么！</d>
[Audio] ambient sound and action sound only: 雨声与雷声，脚步与呼吸声.`;

const f1 = await uploadImage(new Blob([readFileSync(join(DIR, 'F1-起势.png'))]), 'ab-f1.png');
const f4 = await uploadImage(new Blob([readFileSync(join(DIR, 'F4-落势.png'))]), 'ab-f4.png');
const wf = inject(FLF2V, { '<<FRAME>>': f1, '<<LAST_FRAME>>': f4, '<<PROMPT>>': V2, '<<LENGTH>>': 158, '<<SEED>>': SEED });
const { prompt_id } = await (await fetch(`${BASE}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'ab-v2' }) })).json();
console.log('v2 提交:', prompt_id);
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
        writeFileSync(join(DIR, 'v2-6s.mp4'), Buffer.from(await blob.arrayBuffer()));
        writeFileSync(join(DIR, 'v2-prompt.txt'), V2);
        console.log(`✓ v2 完成（${Math.round((Date.now() - t0) / 1000)}s）→ logs/ab-test/v2-6s.mp4`);
        process.exit(0);
      }
    }
  }
  if (e && !e.status?.completed && e.status?.status_str === 'error') { console.error('执行失败'); process.exit(1); }
  if (Date.now() - t0 > 20 * 60_000) { console.error('20 分钟超时'); process.exit(1); }
}
