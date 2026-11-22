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
import { withWorkLock } from '../../middleware/writer';
import { readWork, worksDir, wrap } from './works';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { libraryDir } from '../library/crud';
import { join } from 'node:path';

const importSchema = z.object({ source: z.string().min(1).max(100) });

/** 资料导入固定走 claude/MiniMax 通道（web_search 仅该端点支持）+ 固定模型（当前生产同款） */
const IMPORT_MODEL = 'MiniMax-M3.1-Flash';

/**
 * 原著资料专用客户端（直接调 MiniMax anthropic 端点，不走 services/llm 文本聚合层）：
 * web_search 多轮搜索会触发 stop_reason=pause_turn（长工具链暂停）——此时必须把
 * assistant content blocks 原样回传继续，直到 end_turn。≤4 轮防失控。
 */
async function searchAndCompile(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  source: string,
): Promise<string> {
  const secrets = await readJson<{ claude?: { apiKey?: string; baseUrl?: string } }>(
    join(worksDir(), '..', 'secrets.json'),
  );
  const apiKey = secrets?.claude?.apiKey;
  if (!apiKey) throw new Error('claude 通道未配置（secrets.json 无 apiKey）');
  const base = (secrets?.claude?.baseUrl ?? 'https://api.minimaxi.com/anthropic').replace(/\/$/, '');
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  let convo: Array<{ role: 'user' | 'assistant'; content: unknown }> = messages
    .filter((m) => m.role === 'user')
    .map((m) => ({ role: 'user' as const, content: m.content }));

  for (let turn = 0; turn < 4; turn += 1) {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: IMPORT_MODEL,
        max_tokens: 8000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        ...(system ? { system } : {}),
        messages: convo,
      }),
    });
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
      error?: { message?: string };
    };
    if (!res.ok || data.error) {
      throw new Error(data.error?.message ?? `HTTP ${res.status}`);
    }
    const blocks = data.content ?? [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    if (data.stop_reason === 'pause_turn') {
      convo = [...convo, { role: 'assistant', content: blocks }];
      continue;
    }
    if (text.trim()) return text;
    throw new Error('模型无有效输出（stop=' + (data.stop_reason ?? 'unknown') + '）');
  }
  void source;
  throw new Error('搜索整理轮次超限（4 轮未完成）');
}

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

    // 联网搜索 + 整理（专用客户端：web_search 多轮会触发 anthropic pause_turn——
    // 需要把 assistant content 块原样回传续跑，通用文本聚合层不认识该语义）
    let raw: string;
    try {
      raw = await searchAndCompile(importPrompt(source), source);
    } catch (err) {
      res.status(502).json({ error: `联网搜索失败：${err instanceof Error ? err.message.slice(0, 160) : '未知错误'}` });
      return;
    }
    let entries: Array<{ title: string; keys: string[]; content: string }>;
    try {
      entries = parseEntries(raw);
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
