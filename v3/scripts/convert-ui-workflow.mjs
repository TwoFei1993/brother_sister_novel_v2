#!/usr/bin/env node
/**
 * ComfyUI 工作流 UI 格式 → API 格式转换器（C2 接线用）
 *
 * 输入官方/社区 UI 格式 workflow（nodes+links），输出 API 格式（{id:{class_type,inputs}}），
 * 并按节点类型/标题注入 App 占位符：首帧 <<FRAME>> / 尾帧 <<LAST_FRAME>> / 提示词 <<PROMPT>>
 * / 帧数 <<LENGTH>> / 种子 <<SEED>>。输出 stdout，重定向保存。
 *
 * 用法：node scripts/convert-ui-workflow.mjs <input.json> [output.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inFile, outFile] = process.argv;
const wf = JSON.parse(readFileSync(inFile, 'utf8'));
const nodes = wf.nodes ?? [];
const links = new Map((wf.links ?? []).map((l) => [l[0], l]));

/** UI 节点 widgets_values 按节点类型的字段序（只列需要占位符/透传的关键节点；其余原样透传 inputs 属性值） */
const api = {};
for (const n of nodes) {
  const inputs = {};
  // 1) 显式 inputs（属性面板连线/值）
  for (const inp of n.inputs ?? []) {
    if (inp.link != null) {
      const l = links.get(inp.link);
      if (l) inputs[inp.name] = [String(l[1]), l[2]];
    } else if (inp.widget !== undefined && Array.isArray(n.widgets_values) && n.widgets_values[inp.widget] !== undefined) {
      // 属性区 widget 的值在 widgets_values[inp.widget]
      inputs[inp.name] = n.widgets_values[inp.widget];
    }
  }
  // 2) 节体 widgets（未在 inputs 里出现的按序消费 widgets_values 剩余值——近似：按 widgets 顺序已由 inp.widget 索引覆盖大部分；
  //    兜底：若节点无 inputs 引用 widgets，则按顺序铺 widgets_value 到常见字段名）
  const wv = n.widgets_values ?? [];
  const type = n.type;
  const setIfMissing = (k, v) => { if (inputs[k] === undefined && v !== undefined) inputs[k] = v; };
  if (type === 'LoadImage') { setIfMissing('image', wv[0]); setIfMissing('upload', wv[1] ?? 'image'); }
  else if (type === 'PrimitiveStringMultiline') { setIfMissing('string', wv[0]); }
  else if (type === 'RandomNoise') { setIfMissing('noise_seed', wv[0]); }
  else if (type === 'KSamplerSelect') { setIfMissing('sampler_name', wv[0]); }
  else if (type === 'BasicScheduler') { setIfMissing('scheduler', wv[1]); setIfMissing('steps', wv[2]); setIfMissing('denoise', wv[3]); }
  else if (type === 'ManualSigmas') { setIfMissing('sigmas', wv[0]); }
  else if (type === 'SplitSigmas') { setIfMissing('split', wv[0]); }
  else if (type === 'PrimitiveFloat') { setIfMissing('value', wv[0] ?? wv[wv.length - 1]); }
  else if (type === 'PrimitiveInt') { setIfMissing('value', wv[0]); }
  else if (type === 'VAELoader') { setIfMissing('vae_name', wv[0]); }
  else if (type === 'CLIPLoader') { setIfMissing('clip_name', wv[0]); setIfMissing('type', wv[1]); }
  else if (type === 'UNETLoader' || type === 'HyperFlowLoader') { setIfMissing('unet_name', wv[0]); setIfMissing('weights_in', wv[1]); }
  else if (type === 'MiniMaxH3ImageToVideo') { setIfMissing('prompt', wv[0]); setIfMissing('width', wv[1]); setIfMissing('height', wv[2]); setIfMissing('length', wv[3]); }
  else if (type === 'MinimaxH3LatentUpscaler3D') { /* 全属性面板，inputs 已覆盖 */ }
  else if (type === 'SaveVideo') { setIfMissing('filename_prefix', wv[0]); setIfMissing('format', wv[1] ?? 'mp4'); }
  else if (type === 'CreateVideo') { setIfMissing('fps', wv[0]); }
  else if (type.startsWith('VHS_')) { /* 跳过（模板内预览用） */ }
  else if (Array.isArray(wv) && wv.length && typeof n.inputs?.[0] === 'undefined') {
    // 未知类型兜底：无名 widget 值无法可靠映射，跳过（宁可缺也不错配）
  }
  api[String(n.id)] = { class_type: type, inputs, _meta: { title: n.title ?? type } };
}

// 3) 占位符注入：条件节点的 prompt/length 常来自 Primitive 源节点连线——先建连线图再改写源
let frameDone = false, lastDone = false, seedDone = false;
/** 反查：被 MiniMaxH3ImageToVideo.{prompt,length} 引用的源节点 id → 字段名 */
const srcField = new Map(); // srcNodeId -> 'prompt' | 'length'
for (const e of Object.values(api)) {
  if (e.class_type === 'MiniMaxH3ImageToVideo') {
    for (const field of ['prompt', 'length']) {
      const v = e.inputs[field];
      if (Array.isArray(v)) srcField.set(String(v[0]), field);
    }
  }
}
for (const n of nodes) {
  const e = api[String(n.id)];
  if (!e) continue;
  if (n.type === 'LoadImage' && !frameDone) { e.inputs.image = '<<FRAME>>'; frameDone = true; }
  else if (n.type === 'LoadImage' && frameDone && !lastDone) { e.inputs.image = '<<LAST_FRAME>>'; lastDone = true; }
  if (n.type === 'RandomNoise' && !seedDone) { e.inputs.noise_seed = '<<SEED>>'; seedDone = true; }
  if (n.type === 'MiniMaxH3ImageToVideo') {
    if (typeof e.inputs.prompt === 'string') e.inputs.prompt = '<<PROMPT>>';
    if (typeof e.inputs.length === 'number' || typeof e.inputs.length === 'string') e.inputs.length = '<<LENGTH>>';
  }
  // 源节点改写：PrimitiveStringMultiline→PROMPT / Primitive*→LENGTH
  const field = srcField.get(String(n.id));
  if (field === 'prompt' && n.type === 'PrimitiveStringMultiline') e.inputs.string = '<<PROMPT>>';
  if (field === 'length' && (n.type === 'PrimitiveInt' || n.type === 'PrimitiveFloat')) {
    for (const k of ['value', 'string_val', 'int_val', 'float_val']) {
      if (e.inputs[k] !== undefined) e.inputs[k] = '<<LENGTH>>';
    }
  }
}

const out = JSON.stringify(api, null, 1);
if (outFile) writeFileSync(outFile, out);
else process.stdout.write(out);
console.error(`转换完成：${nodes.length} 节点 → ${Object.keys(api).length} API 条目；占位符：FRAME=${frameDone} LAST=${lastDone} SEED=${seedDone}`);
