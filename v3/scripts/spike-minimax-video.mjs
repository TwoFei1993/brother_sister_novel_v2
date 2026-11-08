/**
 * Spike：MiniMax 视频生成 API（H3）实测——回答「剧本能否直接生成视频」
 *
 * S1 文生视频（Lite/480P/4s 最便宜）：验证 key 可用 + 异步任务流（创建→轮询→下载）
 * S2 图生视频（可选 --grid <png>）：四宫格图作首帧 → 视频（Data URL 传法，参照生图 spike 教训）
 *
 * 用法：node scripts/spike-minimax-video.mjs [--grid path/to/grid.png]
 * 产出：v3/data/spike-images/spike-video-*.mp4
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = JSON.parse(readFileSync(join(HERE, '..', 'data', 'secrets.json'), 'utf8')).claude?.apiKey ?? '';
const BASE = 'https://api.minimaxi.com';
const OUT = join(HERE, '..', 'data', 'spike-images');
if (!KEY) { console.error('✗ 无 key'); process.exit(1); }

async function createTask(body, label) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v2/video_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  console.log(`\n== ${label} 创建 (HTTP ${res.status}, ${Date.now() - t0}ms)`, JSON.stringify(json).slice(0, 300));
  return json;
}

async function pollTask(taskId, label, maxSec = 600) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxSec * 1000) {
    const res = await fetch(`${BASE}/v2/query/video_generation/${taskId}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const j = await res.json().catch(() => ({}));
    const st = j?.status ?? j?.task_status ?? '?';
    const file = j?.file ?? j?.file_info;
    if (st === 'success' || st === 'succeed' || file?.download_url) {
      console.log(`[${label}] 完成 (${Math.round((Date.now() - t0) / 1000)}s)`);
      return j;
    }
    if (st === 'fail' || st === 'failed') {
      console.log(`[${label}] 失败：`, JSON.stringify(j).slice(0, 400));
      return null;
    }
    process.stdout.write(`[${label}] ${st} ${Math.round((Date.now() - t0) / 1000)}s\r`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`[${label}] 超时`);
  return null;
}

async function downloadVideo(url, tag) {
  const r = await fetch(url);
  if (!r.ok) { console.log('✗ 下载失败', r.status); return; }
  const buf = Buffer.from(await r.arrayBuffer());
  const f = join(OUT, `${tag}.mp4`);
  writeFileSync(f, buf);
  console.log(`✓ 视频 ${(buf.length / 1024 / 1024).toFixed(2)}MB → ${f}`);
}

// ---------- S1 文生视频 ----------
console.log('===== S1 文生视频（MiniMax-H3-Lite / 480P / 4s）=====');
const s1 = await createTask({
  model: 'MiniMax-H3-Lite',
  content: [{ type: 'text', text: '日系动漫风格：深夜食堂小店，圆脸老板在热气腾腾的灶台前煮一碗葱油拌面，镜头缓慢推近，暖黄灯光' }],
  resolution: '480P',
  duration: 4,
  ratio: '16:9',
}, 'S1 文生视频');
let s1File = null;
if (s1?.task_id) {
  const done = await pollTask(s1.task_id, 'S1');
  const url = done?.file?.download_url ?? done?.file_info?.download_url;
  if (url) { await downloadVideo(url, 'spike-video-t2v'); s1File = url; }
}

// ---------- S2 图生视频（四宫格首帧，Data URL 传法） ----------
const gridIdx = process.argv.indexOf('--grid');
const gridPath = gridIdx > 0 ? process.argv[gridIdx + 1] : null;
if (gridPath && existsSync(gridPath)) {
  console.log('\n===== S2 图生视频（四宫格作首帧 + 提示词）=====');
  const b64 = readFileSync(gridPath).toString('base64');
  const s2 = await createTask({
    model: 'MiniMax-H3-Lite',
    content: [
      { type: 'text', text: '按四宫格参考图的动作顺序生成连贯视频：蓝发双马尾少女从蜷睡中惊醒、抓住扶杆、转头望向舷窗外星流，日系动漫风格，动作自然衔接' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` }, role: 'first_frame' },
    ],
    resolution: '480P',
    duration: 4,
    ratio: 'adaptive',
  }, 'S2 图生视频');
  if (s2?.task_id) {
    const done = await pollTask(s2.task_id, 'S2');
    const url = done?.file?.download_url ?? done?.file_info?.download_url;
    if (url) await downloadVideo(url, 'spike-video-i2v');
  }
} else {
  console.log('\n（跳过 S2：--grid <四宫格png路径>）');
}

console.log('\n========== 汇总 ==========');
console.log(`S1 文生视频：${s1File ? '✓ 可用（剧本→视频链路成立）' : s1?.task_id ? '△ 任务创建成功但未完成' : '✗ 不可用'}`);
