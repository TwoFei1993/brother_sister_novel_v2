/**
 * AI 预选主预设条目（用户需求 2026-11-24：「不完全是自己选，是 AI 先根据要求预选好，人工调整」）：
 * POST /works/:id/preset-pick → 读书籍信息（题材/基调/简介/同人原著）与主预设的
 * 文风/情感基调/附加选项分组条目清单 → LLM 挑选 → 返回覆盖草稿 + 每条理由。
 * 不落库：前端把返回的 overrides 作为草稿展示（标「AI 推荐」+ 理由），用户调整后自行保存。
 *
 * 模型：固定 claude/MiniMax（与 fandom-import 同先例）；同人书带原著信息时开启联网搜索
 * （原著文风/氛围是挑选的重要依据，冷门原著靠搜索兜底）。
 */
import { join } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';

import type { PresetGroup } from '@shared/engine/prompt/preset-overrides';
import { detectPresetGroups, PRESET_GROUP_CATEGORY_LABELS } from '@shared/engine/prompt/preset-overrides';
import type { PresetAsset } from '@shared/preset';
import { FANDOM_TYPE_LABELS, type Work } from '@shared/work';

import { zodBody } from '../../middleware/validate';
import { collectWithDefense } from '../../services/llm/defense';
import { readJson } from '../../storage/store';
import { readWork, wrap, worksDir } from './works';

const IMPORT_SOURCE = 'claude' as const;
const IMPORT_MODEL = 'MiniMax-M3.1-Flash';

const pickSchema = z.object({});

/** 条目清单（给 LLM 的候选集：名称 + 内容摘要，控制 token） */
function entryDigest(group: PresetGroup): string {
  return group.members
    .map((m) => {
      const digest = m.content.replace(/\s+/g, ' ').slice(0, 110);
      return `- identifier=${m.identifier}｜名称：${m.name}｜要点：${digest}${m.enabled ? '（预设默认开启）' : ''}`;
    })
    .join('\n');
}

function pickPrompt(bookInfo: string, groups: PresetGroup[]): string {
  const sections = groups.map(
    (g) =>
      `【${PRESET_GROUP_CATEGORY_LABELS[g.category]}组】(${g.mode === 'single' ? '单选：只选一条最合适的' : '多选：挑最适合本书的，宁缺毋滥'})\n${entryDigest(g)}`,
  );
  return (
    `根据这本小说的信息，从预设条目中为它挑选最合适的配置。\n\n` +
    `【书籍信息】\n${bookInfo}\n\n【候选条目】\n${sections.join('\n\n')}\n\n` +
    `输出纯 JSON 对象（不要 markdown 代码块、不要解释文字）：\n` +
    `{"picks":[{"identifier":"条目的 identifier 原样","reason":"一句话挑选理由（20 字内）"}]}\n` +
    `要求：文风组恰好 1 条；情感基调 1-3 条；附加选项 0-4 条（只挑真正适合的，没有就整个组不出现）。` +
    `identifier 必须从候选清单原样复制，禁止编造。`
  );
}

/** 从 LLM 输出解析 picks；identifier 不在候选清单里的（编造）丢弃 */
function parsePicks(
  raw: string,
  groups: PresetGroup[],
): { overrides: Record<string, boolean>; reasons: Record<string, string> } {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const objStart = text.indexOf('{');
  if (objStart >= 0) text = text.slice(objStart);
  const parsed: unknown = JSON.parse(text);
  const record = parsed as { picks?: unknown };
  const picks: Array<Record<string, unknown>> = Array.isArray(parsed)
    ? (parsed as Array<Record<string, unknown>>)
    : Array.isArray(record.picks)
      ? (record.picks as Array<Record<string, unknown>>)
      : [];
  const known = new Set<string>();
  for (const g of groups) for (const m of g.members) known.add(m.identifier);
  const overrides: Record<string, boolean> = {};
  const reasons: Record<string, string> = {};
  for (const p of picks) {
    const id = typeof p.identifier === 'string' ? p.identifier : '';
    if (!known.has(id)) continue;
    overrides[id] = true;
    if (typeof p.reason === 'string' && p.reason.trim()) reasons[id] = p.reason.trim().slice(0, 60);
  }
  // 单选组语义：选中一条后，组内其余条目关闭（与 pickSingle/isEffective 同一语义）
  for (const g of groups) {
    if (g.mode === 'single' && g.members.some((m) => overrides[m.identifier] === true)) {
      for (const m of g.members) if (!(m.identifier in overrides)) overrides[m.identifier] = false;
    }
  }
  return { overrides, reasons };
}

/** 书籍信息摘要（AI 挑选的依据） */
function bookInfoOf(work: Work): string {
  const s = work.settings;
  const bits: string[] = [`题材：${s.customGenre || s.subGenre}（${work.genre}）`];
  const tones = [...s.storyTones, s.customStoryTone].filter(Boolean).join('、');
  if (tones) bits.push(`基调：${tones}`);
  const style = s.customWritingStyle || (s.writingStyle !== 'default' ? s.writingStyle : '');
  if (style) bits.push(`写作风格：${style}`);
  if (s.backgroundNote.trim()) bits.push(`背景：${s.backgroundNote.trim().slice(0, 300)}`);
  if (s.coreConflict.trim()) bits.push(`核心矛盾：${s.coreConflict.trim().slice(0, 200)}`);
  if (work.genre === 'fanfic' && s.fandomSource?.trim()) {
    const typeLabel = s.fandomType ? FANDOM_TYPE_LABELS[s.fandomType] : undefined;
    bits.push(`同人原著：${s.fandomSource.trim()}${typeLabel ? `（${typeLabel}）` : ''}`);
    if (s.fandomNotes?.trim()) bits.push(`同人要点：${s.fandomNotes.trim().slice(0, 300)}`);
  }
  return bits.join('\n');
}

export const presetPickRouter = Router({ mergeParams: true });

presetPickRouter.post(
  '/preset-pick',
  zodBody(pickSchema),
  wrap(async (req, res) => {
    const workId = req.params.id;
    const work = await readWork(workId);

    if (!work.presetId) {
      res.status(400).json({ error: '本书未绑定主预设——先在绑定里选择预设，再 AI 预选' });
      return;
    }
    const asset = (
      await readJson<PresetAsset>(join(worksDir(), '..', 'presets', `${work.presetId}.json`)).catch(() => null)
    )!;
    if (!asset) {
      res.status(400).json({ error: '主预设资产不存在' });
      return;
    }
    const groups: PresetGroup[] = detectPresetGroups(asset.raw);
    if (groups.length === 0) {
      res.status(400).json({ error: '当前主预设没有可按书选择的文风分组' });
      return;
    }

    const bookInfo = bookInfoOf(work);
    // 同人书：原著文风/氛围是挑选依据，开联网搜索兜底（非同人不开，省 token）
    const webSearchUses = work.genre === 'fanfic' && bookInfo.includes('同人原著') ? 2 : 0;

    const r = await collectWithDefense({
      source: IMPORT_SOURCE,
      model: IMPORT_MODEL,
      messages: [
        {
          role: 'system',
          content:
            '你是网文配置顾问。根据书籍信息从预设条目中挑选最合适的组合。输出必须是纯 JSON 对象（不要 markdown 代码块、不要解释文字）。',
        },
        { role: 'user', content: pickPrompt(bookInfo, groups) },
      ],
      params: { webSearchUses },
      maxTokens: 4000,
    });
    let picked: { overrides: Record<string, boolean>; reasons: Record<string, string> };
    try {
      picked = parsePicks(r.text, groups);
    } catch {
      res.status(502).json({ error: 'AI 输出无法解析，请重试一次' });
      return;
    }
    if (Object.keys(picked.overrides).length === 0) {
      res.status(502).json({ error: 'AI 未选出有效条目，请重试一次' });
      return;
    }
    res.json({ overrides: picked.overrides, reasons: picked.reasons });
  }),
);
