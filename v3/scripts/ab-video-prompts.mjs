#!/usr/bin/env node
/**
 * A/B 实测：视频提示词 v1（三句话）vs v2（四帧时间轴，2026-11-14 升级版）
 *
 * 流程：Z-Image-Turbo 本地生成首尾帧（李薇样例 F1/F4）→ 同 seed 各提交一条 flf2v 6s（158帧）
 * → 轮询取片落 logs/ab-test/ → 输出两片路径与两版 prompt 全文，人工对比动作连贯性。
 *
 * 用法：node scripts/ab-video-prompts.mjs （引擎须在线：scripts/comfy-start.sh）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.COMFY_URL ?? 'http://127.0.0.1:8188';
const OUT_DIR = 'logs/ab-test';
const SEED = 20261114;

// ---------- 模板提取（从 client 内置模板文件抽，保证与 App 通道一致） ----------
const src = readFileSync(new URL('../client/src/features/duanju/lib/comfyDefaultWorkflow.ts', import.meta.url), 'utf8');
const tpl = (name) => {
  const m = src.match(new RegExp(`${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`模板 ${name} 提取失败`);
  return m[1];
};
const Z_IMAGE = tpl('Z_IMAGE_TURBO_DEFAULT_WORKFLOW');
const FLF2V = tpl('HYPERFLOW_FLF2V_DEFAULT_WORKFLOW');

/** 占位符替换（与 comfy.ts injectWorkflow 同语义：JSON 转义防换行/引号破坏 JSON） */
function inject(text, ph) {
  let t = text;
  for (const [k, v] of Object.entries(ph)) t = t.split(k).join(JSON.stringify(String(v)).slice(1, -1));
  return JSON.parse(t);
}

const jpost = async (path, body) => (await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

async function uploadImage(blob, name) {
  const form = new FormData();
  form.append('image', new File([blob], name, { type: 'image/png' }));
  form.append('overwrite', 'true');
  const r = await fetch(`${BASE}/upload/image`, { method: 'POST', body: form });
  const j = await r.json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

/** 提交 → 轮询 history → 取产物（SaveImage/SaveVideo 通用：找含 images 的节点） */
async function runWorkflow(wf, label) {
  const { prompt_id } = await jpost('/prompt', { prompt: wf, client_id: 'ab-test' });
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const h = await (await fetch(`${BASE}/history/${prompt_id}`)).json();
    const entry = h[prompt_id];
    if (entry?.status?.completed) {
      for (const node of Object.values(entry.outputs)) {
        const img = node?.images?.[0] ?? node?.gifs?.[0];
        if (img) {
          const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
          const blob = await (await fetch(`${BASE}/view?${q}`)).blob();
          return { blob, sec: Math.round((Date.now() - t0) / 1000) };
        }
      }
    }
    if (Date.now() - t0 > 20 * 60_000) throw new Error(`${label} 20 分钟超时`);
    if (entry && !entry.status?.completed && entry.status?.status_str === 'error') throw new Error(`${label} 执行失败`);
  }
}

// ---------- ① Z-Image 生成首尾帧 ----------
const CHAR = '李薇（28岁女记者，黑色齐肩发微湿贴颊，深棕色瞳，眉骨清晰下颌线紧；身高165cm；米色长风衣配深灰高领与直筒裤，黑色短靴；左腕旧机械表）';
const STYLE = '干净的日式二维动画插画，赛璐璐上色，平涂明亮通透的色彩，头发成束绘制带光泽高光带';
const F1 = `${STYLE}，电影感单帧分镜图（同一镜头连续动作第 1/4 帧）
【画面主体】李薇在昏黄路灯下的湿滑巷口猛地转身，风衣下摆甩起水珠——画面停在「下一秒即将发生变化」的时刻；她眉头紧锁张嘴嘶吼，握手机的手指节泛白；逆光剪影，霓虹在湿地面映出冷蓝反光
【出场人物】${CHAR}——画面中恰好出现 1 名角色，每名角色只出现一次
【场景与光线】雨夜巷口：狭窄巷道湿滑沥青映霓虹，砖墙斑驳；顶光昏黄路灯逆光剪影，冷蓝霓虹辅光；深夜暴雨
【镜头语言】膝盖以上入画，人物动作与姿态为画面主体（中景）；人物位置：画面中央
【环境动态】风吹发丝与衣摆，雨丝斜落，水面涟漪
画质要求：细节丰富，光影真实，构图稳定横平竖直`;
const F4 = `${STYLE}，电影感单帧分镜图（同一镜头连续动作第 4/4 帧）
【画面主体】李薇背靠砖墙缓缓滑坐在地，手机滑落到积水中屏幕朝上还亮着——她仰头靠墙，泪水和雨水混在一起，嘴唇微微颤抖，将起身未起的疲惫瞬间
【出场人物】${CHAR}——画面中恰好出现 1 名角色，每名角色只出现一次
【场景与光线】雨夜巷口：同上；手机屏幕冷白光照亮她泛红的眼眶
【镜头语言】膝盖以上入画（中景）；人物位置：画面中央偏下
【环境动态】雨丝渐小，积水涟漪，手机屏光晕
画质要求：细节丰富，光影真实，构图稳定横平竖直`;

// ---------- ② 两版视频提示词（同素材同 seed，仅 prompt 不同） ----------
const V1 = `One continuous cinematic vertical shot: 李薇在昏黄路灯下的湿滑巷口猛地转身，风衣下摆甩起水珠；她眉头紧锁张嘴嘶吼，握手机的手指节泛白；逆光剪影，霓虹在湿地面映出冷蓝反光; camera 推, 画面中央. <d>[Chinese] 你到底隐瞒了什么！</d> Audio: 雨声与雷声，脚步与呼吸声.`;
const V2 = `[Character spec] ${CHAR} — appearance must stay identical to the reference frames throughout.
How the reference pictures align: picture 1 matches the opening frame exactly at 0.0s, picture 2 matches the closing frame exactly at 6.6s.
[0.0s-1.7s] 李薇在昏黄路灯下的湿滑巷口猛地转身，风衣下摆甩起水珠；她眉头紧锁张嘴嘶吼，握手机的手指节泛白；逆光剪影，霓虹在湿地面映出冷蓝反光 — precisely match the opening state
[1.7s-3.3s] 李薇向前逼近一步，雨水顺着发梢滴落，手机屏幕的光照亮她泛红的眼眶；她咬紧下唇，胸口剧烈起伏，将质问未问
[3.3s-5.0s] 李薇伸手抓住对方衣袖用力一扯，两人距离骤然拉近；雨水在两人之间溅起细碎水花，霓虹灯在积水中碎成光斑
[5.0s-6.6s] 李薇背靠砖墙缓缓滑坐在地，手机滑落到积水里屏幕朝上；她仰头靠墙，泪水和雨水混在一起，嘴唇微微颤抖 — arrive exactly at the closing frame state
[Camera] slow dolly-in toward the subject; 画面中央.
<d>[Chinese] 你到底隐瞒了什么！</d>
[Audio] ambient sound and action sound only: 雨声与雷声，脚步与呼吸声.`;

// ---------- 执行 ----------
mkdirSync(OUT_DIR, { recursive: true });
console.log('[1/4] Z-Image 生成首帧…');
const f1 = await runWorkflow(inject(Z_IMAGE, { '<<PROMPT>>': F1, '<<WIDTH>>': 768, '<<HEIGHT>>': 1344, '<<SEED>>': SEED }), '首帧');
writeFileSync(join(OUT_DIR, 'F1-起势.png'), Buffer.from(await f1.blob.arrayBuffer()));
console.log(`  ✓ ${f1.sec}s`);
console.log('[2/4] Z-Image 生成尾帧…');
const f4 = await runWorkflow(inject(Z_IMAGE, { '<<PROMPT>>': F4, '<<WIDTH>>': 768, '<<HEIGHT>>': 1344, '<<SEED>>': SEED + 1 }), '尾帧');
writeFileSync(join(OUT_DIR, 'F4-落势.png'), Buffer.from(await f4.blob.arrayBuffer()));
console.log(`  ✓ ${f4.sec}s`);

const up1 = await uploadImage(f1.blob, 'ab-f1.png');
const up4 = await uploadImage(f4.blob, 'ab-f4.png');

for (const [name, prompt] of [['v1-三句话', V1], ['v2-时间轴', V2]]) {
  const tag = name.startsWith('v1') ? 'v1' : 'v2';
  console.log(`[3-4/4] ${name} flf2v 6.6s（158帧）… 预计 ~9 分钟`);
  const wf = inject(FLF2V, { '<<FRAME>>': up1, '<<LAST_FRAME>>': up4, '<<PROMPT>>': prompt, '<<LENGTH>>': 158, '<<SEED>>': SEED });
  const out = await runWorkflow(wf, name);
  writeFileSync(join(OUT_DIR, `${tag}-6s.mp4`), Buffer.from(await out.blob.arrayBuffer()));
  writeFileSync(join(OUT_DIR, `${tag}-prompt.txt`), prompt);
  console.log(`  ✓ ${tag}: ${out.sec}s → logs/ab-test/${tag}-6s.mp4`);
}
console.log('\n=== 完成：人工对比 logs/ab-test/ 下 v1-6s.mp4 vs v2-6s.mp4（同首尾帧同 seed，仅提示词不同）===');
