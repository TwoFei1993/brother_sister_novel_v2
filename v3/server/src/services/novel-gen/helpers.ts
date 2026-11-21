/**
 * server 端组装的 IO 缝实现（M2 Task 3.1；自 assemble.ts 拆出，控制单文件 ≤300 行）：
 * 滚动摘要 LLM（runGenerate 非流式）与摘要落库（work.json 锁内读-改-写）。
 * 对齐 client 版语义的说明见各函数注释（D5 不允许语义漂移）。
 */
import type { Work } from '@shared/work';
import { buildSummarizePrompt } from '@shared/engine/prompt/novel/memory';

import { runGenerate } from '../llm';
import { withWorkLock } from '../../middleware/writer';
import { readJson, writeJsonAtomic } from '../../storage/store';
import { workFile } from '../../routes/works/works';
import type { NovelGenPrefs } from './assemble';

/** 摘要 LLM（server 版）：runGenerate 直调非流式，失败返回 null（生成不阻塞）。
 *  system/user 构造、max_tokens=700、temperature=0.3、trim 判空——逐点对齐 client 版
 *  context-plan.summarizeDropped（client 走 /api/llm/generate HTTP，server 直调同参数等价）。 */
export async function summarizeDropped(
  prefs: NovelGenPrefs,
  prevSummary: string | undefined,
  texts: string[],
): Promise<string | null> {
  if (texts.length === 0) return null;
  const { system, user } = buildSummarizePrompt(prevSummary ?? '', texts);
  try {
    let text = '';
    for await (const ev of runGenerate({
      source: prefs.source,
      model: prefs.model ?? '',
      stream: false,
      params: { max_tokens: 700, temperature: 0.3 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    })) {
      if (ev.kind === 'text') text += ev.text;
      if (ev.kind === 'error') return null;
    }
    const out = text.trim();
    return out || null;
  } catch {
    return null;
  }
}

/** 摘要落库（best-effort）：withWorkLock 内读磁盘最新 work 合并写 settings.rollingSummary/
 *  summaryUpTo（并发防覆盖）。与 updateWorkStats 同例：不动 revision/updatedAt——生成通道
 *  自动写不抢占用户会话的乐观锁（client 版走带 revision 的 PATCH，server 直写等价物）。
 *  任何失败静默：摘要已用于本次组装，落盘失败仅影响下次生成的起点。 */
export async function persistRollingSummary(workId: string, fresh: string, upTo: number): Promise<void> {
  await withWorkLock(workId, async () => {
    const current = await readJson<Work>(workFile(workId));
    if (!current) return;
    const next: Work = {
      ...current,
      settings: { ...current.settings, rollingSummary: fresh, summaryUpTo: upTo },
    };
    await writeJsonAtomic(workFile(workId), next);
  }).catch(() => undefined);
}
