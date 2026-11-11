/**
 * 小说 → 短剧一键转换（用户需求 2026-11-11）
 *
 * POST /works/:id/convert-to-duanju：创建新短剧作品（小说本体不动）——
 * 剧本正文 = 小说全文（source:'pasted'），confirmed=true 直接定稿解锁拆解
 * （定稿本身不触发任何付费调用，拆解仍需用户在剧本 tab 主动点击）。
 *
 * 护栏：源必须 mode=novel 且有章节正文；全文 ≤10 万字符（超长提示分卷——
 * 拆解 LLM 的上下文装不下整部长篇，硬塞会产生截断式劣化）。
 */
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { RequestHandler } from 'express';

import { HttpError } from '../../middleware/validate';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { assertSafeId, workFile, worksDir, wrap } from './works';
import { newDuanjuProject } from '@shared/duanju';
import type { Work } from '@shared/work';

const MAX_CHARS = 100_000;

/** 章节 = messages.jsonl 中 role=assistant 且带 chapter 元数据的消息（与 export-novels.mjs 同口径） */
function extractChapters(workId: string): Array<{ index: number; title: string; content: string }> {
  const file = resolve(worksDir(), workId, 'messages.jsonl');
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: Array<{ index: number; title: string; content: string }> = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let m: { role?: string; chapter?: { index?: number; title?: string }; content?: string };
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.role !== 'assistant' || !m.chapter) continue;
    const content = (m.content ?? '').trim();
    if (!content) continue;
    out.push({ index: m.chapter.index ?? 0, title: m.chapter.title ?? `第 ${m.chapter.index ?? '?'} 章`, content });
  }
  return out.sort((a, b) => a.index - b.index);
}

export const convertToDuanju: RequestHandler = async (req, res) => {
  const id = req.params.id;
  assertSafeId(id);
  const source = (await readJson<Work>(workFile(id))) ?? null;
  if (!source) throw new HttpError(404, '作品不存在');
  if (source.mode !== 'novel') throw new HttpError(400, '只有小说作品可以转为短剧');

  const chapters = extractChapters(id);
  if (chapters.length === 0) throw new HttpError(400, '该作品还没有章节正文——先在小说里生成/写入正文');
  const fullText = chapters
    .map((c) => `第 ${c.index} 章 ${c.title}\n${c.content}`)
    .join('\n\n');
  if (fullText.length > MAX_CHARS) {
    throw new HttpError(
      400,
      `正文超长（${fullText.length} 字，上限 10 万）——AI 拆解装不下整部长篇，请分卷转换或删减后重试`,
    );
  }

  const now = Date.now();
  const work: Work = {
    id: randomUUID(),
    revision: 1,
    title: `${source.title}·短剧版`,
    mode: 'duanju',
    genre: source.genre,
    characterIds: [],
    worldbookIds: [],
    factionIds: [],
    presetId: '',
    regexScriptIds: [],
    settings: source.settings,
    voiceMap: source.voiceMap ?? {},
    stats: { messageCount: 0, chapterCount: 0, charCount: 0 },
    createdAt: now,
    updatedAt: now,
  };
  await writeJsonAtomic(workFile(work.id), work);

  const project = newDuanjuProject({ targetEpisodes: 12, style: '动漫风', protagonists: '' }, now);
  project.script = { source: 'pasted', text: fullText, confirmed: true, updatedAt: now };
  await writeJsonAtomic(join(worksDir(), work.id, 'duanju', 'project.json'), project);

  res.status(201).json({ work });
};
