/**
 * 向导资产导入编排（Word 导入实测反馈①⑥）：抽取结果 → 建/批量建角色卡 → 建世界书。
 * 纯编排无 UI：串行 POST /api/characters（进度回调）、POST /api/worldbooks、
 * 作品已存在时的自动合并绑定（getWork 取 revision → PATCH）。向导层只做状态展示。
 * 反馈①：一键导入成功不跳转，返回的资产清单就地展示；ids 同时供反馈⑥「创建作品
 * 自动绑定」使用（时序A：创建作品携带 ids；时序B：建卡时作品已存在 → PATCH 绑定）。
 */
import { apiFetch } from '../../../api/client';
import { getWork, updateWork } from '../../../api/works';
import { buildCardDraft, buildWorldbookDraft } from '../../../lib/outline/draft';
import type { ExtractedOutline } from '../../../lib/outline/wizard';

// ---------- 资产清单（⑥向导顶层状态持久化的数据形状） ----------

/** 本次抽取流程已创建的资产（单独建卡/建书与一键导入均累计合并） */
export interface ImportedAssets {
  characterIds: string[];
  characterNames: string[];
  worldbookIds: string[];
  worldbookNames: string[];
}

export const EMPTY_ASSETS: ImportedAssets = { characterIds: [], characterNames: [], worldbookIds: [], worldbookNames: [] };

/** 累计合并（创建作品时序A把全部已建资产一并带上） */
export function mergeAssets(prev: ImportedAssets, next: Partial<ImportedAssets>): ImportedAssets {
  return {
    characterIds: [...prev.characterIds, ...(next.characterIds ?? [])],
    characterNames: [...prev.characterNames, ...(next.characterNames ?? [])],
    worldbookIds: [...prev.worldbookIds, ...(next.worldbookIds ?? [])],
    worldbookNames: [...prev.worldbookNames, ...(next.worldbookNames ?? [])],
  };
}

/** 是否具备一键导入条件：有人物 且 背景/势力/矛盾任一（世界书才有内容可建） */
export function canImportAll(extracted: ExtractedOutline): boolean {
  return extracted.characters.length > 0 && Boolean(extracted.background || extracted.factions.length > 0 || extracted.conflict);
}

// ---------- 创建编排 ----------

export interface CreateCardsResult {
  ids: string[];
  names: string[];
}

/** 批量建角色卡：串行 POST（服务端同名幂等），每完成一张回调进度；失败即中断上抛 */
export async function createCharacterCards(
  extracted: ExtractedOutline,
  onProgress?: (done: number, total: number) => void,
): Promise<CreateCardsResult> {
  const names = extracted.characters.map((c) => c.name);
  const ids: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i] ?? '';
    const res = await apiFetch<{ id: string }>('/api/characters', {
      method: 'POST',
      body: JSON.stringify({ name, card: buildCardDraft(extracted, name) }),
    });
    ids.push(res.id);
    onProgress?.(i + 1, names.length);
  }
  return { ids, names };
}

/** 建世界书草稿：无背景/势力/矛盾时抛错（调用方提示） */
export async function createWorldbook(extracted: ExtractedOutline): Promise<{ id: string; name: string }> {
  const draft = buildWorldbookDraft(extracted);
  if (Object.keys(draft.raw.entries).length === 0) {
    throw new Error('未抽取到背景/势力/矛盾，无法生成世界书');
  }
  return apiFetch<{ id: string; name: string }>('/api/worldbooks', { method: 'POST', body: JSON.stringify(draft) });
}

/** 一键导入：串行建卡（进度回调）→ 建世界书；返回完整资产清单 */
export async function importAllAssets(
  extracted: ExtractedOutline,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportedAssets> {
  const cards = await createCharacterCards(extracted, onProgress);
  const wb = await createWorldbook(extracted);
  return {
    characterIds: cards.ids,
    characterNames: cards.names,
    worldbookIds: [wb.id],
    worldbookNames: [wb.name],
  };
}

// ---------- 时序B：作品已存在时自动绑定 ----------

/**
 * 本会话向导创建的作品 id（localStorage 持久：先创建作品跳走、返回向导再建卡的
 * 时序B依赖跨组件挂载的记忆；绑定完成后由调用方清除）。
 */
const CREATED_WORK_KEY = 'v3-wizard-created-work-id';

export function readCreatedWorkId(): string | null {
  try {
    return localStorage.getItem(CREATED_WORK_KEY);
  } catch {
    return null;
  }
}

export function writeCreatedWorkId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CREATED_WORK_KEY, id);
    else localStorage.removeItem(CREATED_WORK_KEY);
  } catch {
    /* 存储不可用时静默（仅为自动绑定优化） */
  }
}

/** 把本次创建的资产合并绑定进已有作品（GET revision → PATCH 去重合并）；返回作品标题供提示 */
export async function bindAssetsToWork(
  workId: string,
  assets: { characterIds: string[]; worldbookIds: string[] },
): Promise<string> {
  const work = await getWork(workId);
  const merged = await updateWork(work.id, {
    revision: work.revision,
    characterIds: [...new Set([...work.characterIds, ...assets.characterIds])],
    worldbookIds: [...new Set([...work.worldbookIds, ...assets.worldbookIds])],
  });
  return merged.title;
}
