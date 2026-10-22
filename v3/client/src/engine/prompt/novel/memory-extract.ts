/**
 * 自动记忆抽取（对比 ST 社区 Qvink/Smart Memory 的自托管轻量版）
 *
 * 每 N 章对「最近一章」跑一次 LLM 结构化抽取，产出两类记忆：
 *  - 人物状态卡：位置/伤势/持有物/关系等动态事实（静态档案的补集——剧情会改变它们）
 *  - 伏笔登记：埋下的钩子（待回收），供上下文提醒与回收自查
 *
 * 存储于 NovelSettings.characterState / foreshadows（随作品数据卷持久化），
 * 组装时随【作品设定】块注入（作者可编辑=最终事实源，AI 抽取只是代笔）。
 */

/** 单条伏笔登记 */
export interface Foreshadow {
  /** 稳定 id（回收标记用；对描述取 hash 简化去重） */
  id: string;
  /** 伏笔描述（一句话） */
  desc: string;
  /** 埋设章号 */
  plantedAt: number;
  /** 已回收标记（人工在作品设置里勾选） */
  resolved?: boolean;
}

/** 抽取结果（LLM JSON → 强类型） */
export interface MemoryExtract {
  characterState: string;
  foreshadows: Array<{ desc: string }>;
}

/** 简易稳定 hash（伏笔去重 id 用，非安全用途） */
export function hashId(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export const MEMORY_EXTRACT_SYSTEM = `你是小说连载的连续性编辑。阅读最新一章正文，输出两类结构化记忆（严格 JSON，无其他文字）：
{"characterState":"人物当前状态卡：每位主要角色一小段——所在位置/身体状态/持有物/与其他角色的关系变化。只记录「会随剧情改变」的动态事实，静态设定（外貌/性格）不要写。300 字内。","foreshadows":[{"desc":"本章新埋下的伏笔/悬念钩子，一句话"}]}
规则：只提取「新出现或本章发生变化」的动态事实与「本章新埋」的伏笔；没有就输出空数组/空串。`;

/** 从 LLM 原始输出解析抽取结果（容忍代码块包裹/尾随文字） */
export function parseMemoryExtract(raw: string): MemoryExtract | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { characterState?: unknown; foreshadows?: unknown };
    if (typeof j.characterState !== 'string') return null;
    const foreshadows = Array.isArray(j.foreshadows)
      ? j.foreshadows
          .map((f) => {
            const desc = typeof f === 'object' && f !== null && typeof (f as { desc?: unknown }).desc === 'string' ? ((f as { desc: string }).desc).trim() : '';
            return desc ? { desc } : null;
          })
          .filter((f): f is { desc: string } => f !== null)
      : [];
    return { characterState: j.characterState.trim(), foreshadows };
  } catch {
    return null;
  }
}

/**
 * 合并伏笔登记：新伏笔按 desc 去重（hashId 相同跳过），保留已有登记的原 id 与 plantedAt；
 * resolved 的不复活。返回新列表（不含 id 的旧数据兼容：缺 id 自动补）。
 */
export function mergeForeshadows(
  existing: Foreshadow[] | undefined,
  plantedAt: number,
  fresh: Array<{ desc: string }>,
): Foreshadow[] {
  const base = (existing ?? []).map((f) => ({ id: f.id ?? hashId(f.desc + f.plantedAt), desc: f.desc, plantedAt: f.plantedAt, ...(f.resolved ? { resolved: true } : {}) }));
  const out = [...base];
  for (const f of fresh) {
    const id = hashId(f.desc);
    if (out.some((e) => e.id === id || (e.desc === f.desc && e.plantedAt === plantedAt))) continue;
    out.push({ id, desc: f.desc, plantedAt });
  }
  return out;
}

/** 供注入上下文的未回收伏笔清单文本（空则空串） */
export function foreshadowReminder(list: Foreshadow[] | undefined): string {
  const open = (list ?? []).filter((f) => !f.resolved);
  if (open.length === 0) return '';
  return (
    '【已埋伏笔登记（未回收）——适合时可自然回收，不要强行集中解释】\n' +
    open.map((f, i) => `${i + 1}. ${f.desc}（第${f.plantedAt}章埋）`).join('\n')
  );
}

/** Foreshadow 输入形状（settings 存储格式） */
export interface ForeshadowInput {
  id: string;
  desc: string;
  plantedAt: number;
  resolved?: boolean;
}
