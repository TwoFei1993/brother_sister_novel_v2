/**
 * 同人原著资料自动导入（用户需求 2026-11-22 + 用户授权联网搜索）：
 * POST /works/:id/fandom-import { source } → 联网搜索原著核心设定 → LLM 整理为 JSON 条目
 * → 自动创建世界书资产（constant 条目）→ 绑定本书 worldbookIds → 生成时自动扫描注入。
 *
 * 设计：
 * - 联网：claude 通道 params.webSearchUses=3（web_search server-side 工具，converters/claude）
 *   ——实测 MiniMax anthropic 端点支持，搜索结果注入上下文，模型基于真实资料整理；
 *     冷门作品靠真实资料兜底，知名作品模型知识 + 搜索双重来源
 * - 世界书条目 constant=true：原著设定全书常驻（同人创作的事实基底，不做关键词扫描丢失）
 * - work.worldbookIds 合并写不动 revision（生成通道自动写不抢占用户乐观锁，Task 3.1 先例）
 * - 导入后前端引导在世界书页校对/编辑（AI 整理可能有小误，冷门作品尤甚——界面上明示）
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';

import type { WorldbookAsset } from '@shared/worldbook';

import { zodBody } from '../../middleware/validate';
import { collectWithDefense } from '../../services/llm/defense';
import { withWorkLock } from '../../middleware/writer';
import { readWork, worksDir, wrap } from './works';
import { writeJsonAtomic } from '../../storage/store';
import { libraryDir } from '../library/crud';
import { join } from 'node:path';

const importSchema = z.object({ source: z.string().min(1).max(100) });

/** 资料导入固定走 claude/MiniMax 通道（web_search 仅该端点支持）+ 固定模型（当前生产同款） */
const IMPORT_SOURCE = 'claude' as const;
const IMPORT_MODEL = 'MiniMax-M3.1-Flash';

/** 提示词：联网搜索 + 结构化条目输出（JSON 数组，禁 markdown 代码块包裹——解析侧也兜底容错） */
function importPrompt(source: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        '你是原著资料整理专家。请先联网搜索核实，再基于真实资料整理原著核心设定档案。输出必须是纯 JSON 数组（不要 markdown 代码块、不要解释文字），每条格式：{"title": "条目标题", "keys": ["关键词"], "content": "条目正文"}。',
    },
    {
      role: 'user',
      content:
        `请联网搜索并整理《${source}》的原著核心设定，输出 6-10 条 JSON 条目，必须覆盖：\n` +
        '1. 主要人物与人物关系（含性格关键词）；2. 世界观与时代背景；3. 力量/职业体系（如原著没有则说明无）；\n' +
        '4. 重要事件与时间线（按顺序）；5. 原作文风与叙事基调；6. 其他对同人创作重要的设定（如组织/地名/专有名词）。\n' +
        '每条 content 150-300 字、包含具体细节（人名/地名/术语用原著原名）。基于真实资料整理，不确定的内容标注「（待核实）」。',
    },
  ];
}

/** 从 LLM 输出解析条目数组（容错：剥 ```json 围栏 / 对象包裹 {entries:[…]} / 裸数组） */
function parseEntries(raw: string): Array<{ title: string; keys: string[]; content: string }> {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  const parsed: unknown = JSON.parse(text);
  const arr = Array.isArray(parsed) ? parsed : ((parsed as { entries?: unknown[] }).entries ?? []);
  return (arr as Array<Record<string, unknown>>)
    .filter((e) => typeof e?.title === 'string' && typeof e?.content === 'string')
    .map((e) => ({
      title: String(e.title).slice(0, 80),
      keys: Array.isArray(e.keys) ? e.keys.filter((k): k is string => typeof k === 'string').slice(0, 8) : [],
      content: String(e.content).slice(0, 1200),
    }));
}

export const fandomRouter = Router({ mergeParams: true });

fandomRouter.post(
  '/fandom-import',
  zodBody(importSchema),
  wrap(async (req, res) => {
    const workId = req.params.id;
    const { source } = req.body as z.infer<typeof importSchema>;
    const work = await readWork(workId);
    if (work.genre !== 'fanfic') {
      res.status(400).json({ error: '仅同人题材作品可导入原著资料（请在作品设置中切换题材）' });
      return;
    }

    // 联网搜索 + 整理（三级防线复用：瞬态退避——搜索偶发失败自动重试）
    const r = await collectWithDefense({
      source: IMPORT_SOURCE,
      model: IMPORT_MODEL,
      messages: importPrompt(source),
      params: { webSearchUses: 3 },
      maxTokens: 8000,
    });
    let entries: Array<{ title: string; keys: string[]; content: string }>;
    try {
      entries = parseEntries(r.text);
    } catch {
      res.status(502).json({ error: '资料整理输出无法解析（上游返回非 JSON），请重试一次' });
      return;
    }
    if (entries.length === 0) {
      res.status(502).json({ error: '未整理出有效条目（上游无产出），请重试一次' });
      return;
    }

    // 创建世界书资产（constant 条目：原著设定全书常驻）
    const wbId = randomUUID();
    const wb: WorldbookAsset = {
      id: wbId,
      name: `原著设定-${source}`,
      raw: {
        entries: Object.fromEntries(
          entries.map((e, i) => [
            String(i),
            {
              uid: i,
              key: e.keys.length > 0 ? e.keys : [source],
              content: `【${e.title}】${e.content}`,
              constant: true,
              enabled: true,
              insertion_order: 30 + i,
            },
          ]),
        ),
      },
    };
    await writeJsonAtomic(join(libraryDir('worldbooks'), `${wbId}.json`), wb);

    // 绑定本书 worldbookIds（锁内合并写，revision 不动——生成通道自动写先例）
    const newRevision = await withWorkLock(workId, async () => {
      const latest = await readWork(workId);
      const ids = latest.worldbookIds.includes(wbId) ? latest.worldbookIds : [...latest.worldbookIds, wbId];
      const updated = { ...latest, worldbookIds: ids, updatedAt: Date.now() };
      await writeJsonAtomic(join(worksDir(), workId, 'work.json'), updated);
      return updated.revision;
    });

    res.json({
      worldbookId: wbId,
      name: wb.name,
      entryCount: entries.length,
      titles: entries.map((e) => e.title),
      revision: newRevision,
    });
  }),
);
