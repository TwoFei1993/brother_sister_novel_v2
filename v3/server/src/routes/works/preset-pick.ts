/**
 * AI 预选主预设条目（用户需求 2026-11-24：「不完全是自己选，是 AI 先根据要求预选好，人工调整」）：
 * POST /works/:id/preset-pick        → 读书籍信息（题材/基调/简介/同人原著）与主预设的
 *                                      分组条目清单 → LLM 挑选 → 返回覆盖草稿 + 每条理由。
 * POST /works/preset-pick-preview    → 建书弹窗用（用户反馈 2026-11-27：建书时选了什么文风基调，
 *                                      预设条目就默认勾上对应的，其余照常显示）——书还没建，
 *                                      书籍信息内联传递，其余逻辑相同。
 * 两条路都不落库：前端把返回的 overrides 作为草稿展示，用户调整后自行保存。
 *
 * 模型：固定 claude/MiniMax（与 fandom-import 同先例）；同人书带原著信息时开启联网搜索
 * （原著文风/氛围是挑选的重要依据，冷门原著靠搜索兜底）。
 */
import { join } from 'node:path';
import { Router, type Response } from 'express';
import { z } from 'zod';

import type { PresetGroup } from '@shared/engine/prompt/preset-overrides';
import { detectPresetGroups, PRESET_GROUP_CATEGORY_LABELS } from '@shared/engine/prompt/preset-overrides';
import type { PresetAsset } from '@shared/preset';
import { FANDOM_TYPE_LABELS, WRITING_STYLE_LABELS, type FandomType, type Work, type WritingStyle } from '@shared/work';

import { zodBody } from '../../middleware/validate';
import { collectWithDefense } from '../../services/llm/defense';
import { readJson } from '../../storage/store';
import { readWork, wrap, worksDir } from './works';

const IMPORT_SOURCE = 'claude' as const;
const IMPORT_MODEL = 'MiniMax-M3.1-Flash';

const pickSchema = z.object({});

/** 建书弹窗的预览请求体（书还没建：书籍信息 + 目标预设内联传递） */
const previewSchema = z.strictObject({
  presetId: z.string().min(1),
  title: z.string().default(''),
  genre: z.string(),
  storyTones: z.array(z.string()).default([]),
  customStoryTone: z.string().default(''),
  writingStyle: z.string().default(''),
  customWritingStyle: z.string().default(''),
  backgroundNote: z.string().default(''),
  coreConflict: z.string().default(''),
  fandomSource: z.string().default(''),
  fandomType: z.string().default(''),
  fandomNotes: z.string().default(''),
});
type PreviewBody = z.infer<typeof previewSchema>;

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
    `要求：文风组恰好 1 条；情感基调 1-3 条；附加选项 0-4 条（只挑真正适合的）。` +
    `预设默认开启的通用写作规范类条目（❎反抢话/❎反科幻/❎杀揭示/❎杀说明/❎卡COT 等对抗性规则、💝抢话提醒、🪧多对白）是所有书都受益的通用规范——` +
    `如本书题材不与其冲突，应把它们也选上（默认包含）；与本书题材明显冲突的（如严肃正剧选反科幻以外的）可略过。` +
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

/** 建书弹窗的书籍信息摘要（字段还没进库，直接从请求体拼） */
function bookInfoFromPreview(b: PreviewBody): string {
  const bits: string[] = [`题材：${b.genre}`];
  if (b.title.trim()) bits.push(`书名：${b.title.trim()}`);
  const tones = [...b.storyTones, b.customStoryTone].filter(Boolean).join('、');
  if (tones) bits.push(`基调：${tones}`);
  const style = b.customWritingStyle || (b.writingStyle && b.writingStyle !== 'default'
    ? (WRITING_STYLE_LABELS[b.writingStyle as WritingStyle] ?? b.writingStyle)
    : '');
  if (style) bits.push(`写作风格：${style}`);
  if (b.backgroundNote.trim()) bits.push(`背景：${b.backgroundNote.trim().slice(0, 300)}`);
  if (b.coreConflict.trim()) bits.push(`核心矛盾：${b.coreConflict.trim().slice(0, 200)}`);
  if (b.fandomSource.trim()) {
    const typeLabel = b.fandomType ? FANDOM_TYPE_LABELS[b.fandomType as FandomType] : undefined;
    bits.push(`同人原著：${b.fandomSource.trim()}${typeLabel ? `（${typeLabel}）` : ''}`);
    if (b.fandomNotes.trim()) bits.push(`同人要点：${b.fandomNotes.trim().slice(0, 300)}`);
  }
  return bits.join('\n');
}

/**
 * 共用挑选流程：加载预设资产 → 只取 文风/基调/附加 三类组作候选 → LLM 挑选 → 解析。
 * 写结果或错误到 res 后返回（不抛出）；调用方在 Handler 里 await。
 */
async function pickAndRespond(res: Response, presetId: string, bookInfo: string): Promise<void> {
  const asset = (
    await readJson<PresetAsset>(join(worksDir(), '..', 'presets', `${presetId}.json`)).catch(() => null)
  )!;
  if (!asset) {
    res.status(400).json({ error: '主预设资产不存在' });
    return;
  }
  const groups: PresetGroup[] = detectPresetGroups(asset.raw).filter((g) => g.category !== 'other');
  if (groups.length === 0) {
    res.status(400).json({ error: '当前主预设没有可按书选择的文风分组' });
    return;
  }
  // 同人书：原著文风/氛围是挑选依据，开联网搜索兜底（非同人不开，省 token）
  const webSearchUses = bookInfo.includes('同人原著') ? 2 : 0;
  const ask = async (): Promise<string> =>
    (
      await collectWithDefense({
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
      })
    ).text;
  // 上游偶发输出不可解析（建书首体验实测遇到一次）：自动重试一次再报 502
  let picked: { overrides: Record<string, boolean>; reasons: Record<string, string> } | null = null;
  for (let attempt = 0; attempt < 2 && !picked; attempt += 1) {
    try {
      picked = parsePicks(await ask(), groups);
    } catch {
      picked = null;
    }
    if (picked && Object.keys(picked.overrides).length === 0) picked = null;
  }
  if (!picked) {
    res.status(502).json({ error: 'AI 预选没成功（上游输出两次都无法解析）——可稍后重试，或手动挑选' });
    return;
  }
  res.json({ overrides: picked.overrides, reasons: picked.reasons });
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
    await pickAndRespond(res, work.presetId, bookInfoOf(work));
  }),
);

/** 建书弹窗预览：书还没建，书籍信息内联（2026-11-27 用户反馈：选了什么就默认勾选对应的，其余照常显示可调） */
export const presetPickPreviewRouter = Router();

presetPickPreviewRouter.post(
  '/preset-pick-preview',
  zodBody(previewSchema),
  wrap(async (req, res) => {
    const body = req.body as PreviewBody;
    await pickAndRespond(res, body.presetId, bookInfoFromPreview(body));
  }),
);
