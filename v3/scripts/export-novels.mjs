#!/usr/bin/env node
/**
 * 批量导出小说正文到本地 txt（用户需求：App 里生成的文章复制到本地）
 *
 * 用法：node scripts/export-novels.mjs [workId]
 *   不带参数 = 导出全部 novel 作品；带 workId = 只导出指定作品。
 * 输出：<repo>/导出小说/<书名>.txt（章节标题 + 正文，按章序拼接）。
 * 章节 = messages.jsonl 中 role=assistant 且带 chapter 元数据的消息。
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WORKS_DIR = resolve(process.cwd(), 'data/works');
const OUT_DIR = resolve(process.cwd(), '../导出小说');
const ONLY = process.argv[2];

mkdirSync(OUT_DIR, { recursive: true });

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 章节正文：assistant 消息按 chapter.index 升序，跳过空正文 */
function extractChapters(messagesPath) {
  let raw;
  try {
    raw = readFileSync(messagesPath, 'utf8');
  } catch {
    return [];
  }
  const chapters = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.role !== 'assistant' || !m.chapter) continue;
    const content = (m.content ?? '').trim();
    if (!content) continue;
    chapters.push({ index: m.chapter.index ?? 0, title: m.chapter.title ?? `第 ${m.chapter.index ?? '?'} 章`, content });
  }
  return chapters.sort((a, b) => a.index - b.index);
}

const exported = [];
for (const dir of readdirSync(WORKS_DIR)) {
  const work = readJson(join(WORKS_DIR, dir, 'work.json'));
  if (!work || work.mode !== 'novel') continue; // 只导小说（duanju 无正文概念）
  if (ONLY && work.id !== ONLY) continue;
  const chapters = extractChapters(join(WORKS_DIR, dir, 'messages.jsonl'));
  if (chapters.length === 0) continue;
  const title = work.title || work.id;
  const total = chapters.reduce((n, c) => n + c.content.length, 0);
  const body = [
    `《${title}》`,
    `共 ${chapters.length} 章 · 约 ${total} 字 · 导出于 ${new Date().toLocaleString('zh-CN')}`,
    '',
    ...chapters.flatMap((c) => [`────── 第 ${c.index} 章 ${c.title} ──────`, '', c.content, '']),
  ].join('\n');
  const safeName = title.replace(/[\\/:*?"<>|]/g, '_');
  writeFileSync(join(OUT_DIR, `${safeName}.txt`), body, 'utf8');
  exported.push({ title, chapters: chapters.length, chars: total, file: `${safeName}.txt` });
}

if (exported.length === 0) {
  console.log('没有可导出的小说作品（mode=novel 且有章节正文）');
} else {
  console.log(`导出 ${exported.length} 部作品 → ${OUT_DIR}`);
  for (const e of exported) console.log(`  《${e.title}》 ${e.chapters} 章 / ${e.chars} 字 → ${e.file}`);
}
