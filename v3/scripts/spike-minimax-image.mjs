/**
 * Phase 0 spike：MiniMax image-01 生图可用性验证（共识 D1 / 实施计划 T0.1）
 *
 * 验证项：
 *   S1 同一 key（secrets.claude.apiKey）能否调国内端点文生图
 *   S2 基本参数（aspect_ratio / n / response_format）与响应结构
 *   S3 返回 URL 可下载（转存可行性）+ 时效
 *   S4 参考图参数（subject_reference 候选名实测）
 *
 * 用法：node scripts/spike-minimax-image.mjs            # S1-S3 文生图
 *       node scripts/spike-minimax-image.mjs --ref a.png # S4 参考图（传本地参考图）
 * 产出：v3/data/spike-images/*.png + 控制台结论
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = JSON.parse(readFileSync(join(HERE, '..', 'data', 'secrets.json'), 'utf8')).claude?.apiKey ?? '';
const URL_BASE = process.env.MINIMAX_IMAGE_HOST ?? 'https://api.minimaxi.com';
const OUT_DIR = join(HERE, '..', 'data', 'spike-images');
const ENDPOINT = `${URL_BASE}/v1/image_generation`;

if (!KEY) {
  console.error('✗ secrets.claude.apiKey 为空，无法 spike');
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

async function callImageGen(body, label) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = { _nonJson: raw.slice(0, 300) }; }
  console.log(`\n===== ${label}（HTTP ${res.status}，${ms}ms）=====`);
  const base = json?.base_resp;
  if (base && base.status_code !== 0) {
    console.log(`✗ base_resp: code=${base.status_code} msg=${base.status_msg}`);
    return null;
  }
  if (!res.ok) {
    console.log(`✗ 非 2xx：${JSON.stringify(json).slice(0, 500)}`);
    return null;
  }
  console.log('✓ 成功。响应字段：', Object.keys(json).join(', '));
  return json;
}

async function download(urls, tag) {
  const saved = [];
  for (let i = 0; i < urls.length; i += 1) {
    const u = urls[i];
    const r = await fetch(u);
    if (!r.ok) { console.log(`✗ 下载失败 [${i}] HTTP ${r.status}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const file = join(OUT_DIR, `${tag}-${i}.png`);
    writeFileSync(file, buf);
    saved.push(file);
    console.log(`✓ 下载 [${i}] ${(buf.length / 1024).toFixed(0)}KB → ${file}`);
  }
  return saved;
}

// ---------- S1-S3：文生图基本链路 ----------
console.log(`端点：${ENDPOINT}`);
console.log(`key 尾号：…${KEY.slice(-6)}`);

const basic = await callImageGen(
  {
    model: 'image-01',
    prompt: '动漫风格，一个黑色长发的少女站在樱花树下，微风吹动发丝，柔和的午后光线，全身像，中性站立姿势，纯色背景',
    aspect_ratio: '3:4',
    response_format: 'url',
    n: 1,
  },
  'S1 文生图（3:4 竖版）',
);

let urlNote = '';
if (basic?.data?.image_urls?.length) {
  const saved = await download(basic.data.image_urls, 's1');
  if (saved.length) {
    urlNote = `URL 可直接下载；文件已存 ${saved.length} 张`;
    console.log(`S3 结论初判：${urlNote}`);
  }
} else if (basic) {
  console.log('⚠ 响应无 data.image_urls，完整结构：', JSON.stringify(basic).slice(0, 600));
}

// ---------- S4：参考图参数 ----------
const refPath = process.argv.includes('--ref')
  ? process.argv[process.argv.indexOf('--ref') + 1]
  : null;

if (refPath && existsSync(refPath)) {
  const b64 = readFileSync(refPath).toString('base64');
  console.log(`\n参考图：${refPath}（${(statSync(refPath).size / 1024).toFixed(0)}KB）`);
  // 候选参数名逐个尝试：官方国际站为 subject_reference；国内站可能为同名字符串数组
  for (const [field, value] of [
    ['subject_reference', b64],
    ['subject_reference', [b64]],
    ['reference_images', [b64]],
  ]) {
    const r = await callImageGen(
      {
        model: 'image-01',
        prompt: '同一个人物，坐在图书馆窗边看书，侧面半身，午后阳光',
        aspect_ratio: '3:4',
        response_format: 'url',
        n: 1,
        [field]: value,
      },
      `S4 参考图 field=${field}(${Array.isArray(value) ? 'array' : 'string'})`,
    );
    if (r?.data?.image_urls?.length) {
      await download(r.data.image_urls, `s4-${field}-${Array.isArray(value) ? 'arr' : 'str'}`);
      console.log(`\n★★★ S4 结论：参数 ${field}（${Array.isArray(value) ? '数组' : '字符串'}形式）可用`);
      break;
    }
  }
} else if (refPath) {
  console.log(`✗ 参考图文件不存在：${refPath}`);
} else {
  console.log('\n（跳过 S4：未传 --ref <图片路径>）');
}

console.log('\n========== spike 汇总 ==========');
console.log(`S1 key 复用：${basic ? '✓（LLM/TTS 同 key 可生图）' : '✗（需独立生图 key 或平台开通）'}`);
console.log(`S2/S3：${urlNote || '见上方明细'}`);
console.log('S4 参考图：见上方逐项结论');
