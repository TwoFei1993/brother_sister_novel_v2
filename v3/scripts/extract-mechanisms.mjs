#!/usr/bin/env node
/**
 * T8 叙事机制库提取（#6）：AICG3D-SKILLS 的 preview_manifest.json（284 条机制中文名+摘要）
 * → client/public/duanju-mechanisms.json（App 分镜页「叙事机制」选择器的数据源，运行时 fetch 按需拉）。
 *
 * 来源许可：T8mars/minimax-h3-prompt-skill-T8 内容 CC BY 4.0（提取仅 id/中文名/摘要索引，
 * 机制正文仍留在原插件——引用式使用；App 内注明来源）。
 * 用法：node scripts/extract-mechanisms.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'D:/网剧参考/custom_nodes/comfyui-AICG3D-SKILLS/preview_manifest.json';
const OUT = join(import.meta.dirname, '../client/public/duanju-mechanisms.json');

const manifest = JSON.parse(readFileSync(SRC, 'utf8'));
const items = Object.entries(manifest)
  .filter(([, v]) => v && typeof v.title === 'string' && typeof v.summary === 'string')
  .map(([id, v]) => ({ id, title: v.title, summary: v.summary }))
  // 摘要截断（个别超长；选择器 tooltip 用）+ 剔除演示性质条目无碍（全部保留，创作者自选）
  .map((it) => ({ ...it, summary: it.summary.length > 120 ? `${it.summary.slice(0, 118)}…` : it.summary }))
  .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));

const payload = {
  version: 1,
  source: 'T8mars/minimax-h3-prompt-skill-T8（CC BY 4.0）— 经 AICG3D-SKILLS preview_manifest 提取',
  count: items.length,
  items,
};
mkdirSync(join(import.meta.dirname, '../client/public'), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload));
console.log(`✓ ${items.length} 条机制 → ${OUT}（${(JSON.stringify(payload).length / 1024).toFixed(0)}KB）`);
