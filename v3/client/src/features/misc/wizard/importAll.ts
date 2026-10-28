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
import { bookOrigin } from '@shared/assets/origin';
import type { ExtractedOutline } from '../../../lib/outline/wizard';
import type { Work } from '@shared/work';

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

// ---------- 最近导入资产持久化（绑定全时序的统一兜底数据源） ----------

/** 最近一次导入流程的累计资产（localStorage 持久；跨时序/跨会话兜底绑定用） */
export interface LastAssets extends ImportedAssets {
  /** 写入时间戳（毫秒），供「绑定向导最近资产」入口展示时效 */
  at: number;
}

const LAST_ASSETS_KEY = 'v3-wizard-last-assets';

/** 导入成功后覆盖写入（传累计资产：单独建卡/建书与一键导入合并后的完整清单） */
export function writeLastAssets(assets: ImportedAssets): void {
  try {
    localStorage.setItem(LAST_ASSETS_KEY, JSON.stringify({ ...assets, at: Date.now() }));
  } catch {
    /* 存储不可用时静默（绑定兜底仅为体验增强） */
  }
}

/** 读取最近导入资产；解析失败/结构不符返回 null（旧版本数据或脏数据自愈） */
export function readLastAssets(): LastAssets | null {
  try {
    const raw = localStorage.getItem(LAST_ASSETS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastAssets> | null;
    if (typeof v !== 'object' || v === null) return null;
    const isStrList = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');
    if (!isStrList(v.characterIds) || !isStrList(v.characterNames) || !isStrList(v.worldbookIds) || !isStrList(v.worldbookNames)) {
      return null;
    }
    if (typeof v.at !== 'number') return null;
    return {
      characterIds: v.characterIds,
      characterNames: v.characterNames,
      worldbookIds: v.worldbookIds,
      worldbookNames: v.worldbookNames,
      at: v.at,
    };
  } catch {
    return null;
  }
}

/** 合并去重保序（既有在前、新增追加去重）：绑定合并与创建携带共用的纯函数 */
export function mergeIdLists(existing: string[], added: string[]): string[] {
  return [...new Set([...existing, ...added])];
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

/**
 * 补写素材归属（生成卡默认有归属）：无归属/显式 none 的素材 PATCH origin=本书；
 * 已归属其他书的不抢走（跨书引用不迁移归属）。尽力而为：单条失败仅告警不阻塞绑定。
 */
export async function attributeAssets(
  workId: string,
  assets: { characterIds: string[]; worldbookIds: string[] },
): Promise<void> {
  const origin = bookOrigin(workId);
  const targets: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['characters', assets.characterIds],
    ['worldbooks', assets.worldbookIds],
  ];
  for (const [type, ids] of targets) {
    for (const id of ids) {
      try {
        const asset = await apiFetch<{ origin?: { type?: string } }>(`/api/${type}/${id}`);
        if (asset.origin?.type === 'book') continue; // 已有归属：不迁移
        await apiFetch(`/api/${type}/${id}`, { method: 'PATCH', body: JSON.stringify({ origin }) });
      } catch (err) {
        console.warn('[importAll] 素材归属补写失败（不影响绑定）', type, id, err);
      }
    }
  }
}

/**
 * 把资产合并绑定进已有作品（GET revision → PATCH 去重合并，保留已有绑定）；返回更新后的 Work。
 * 默认顺带补写归属（生成卡默认有归属）；opts.shared=true 时跳过（标明共享，不归属本书）。
 */
export async function bindAssetsToWork(
  workId: string,
  assets: { characterIds: string[]; worldbookIds: string[] },
  opts: { shared?: boolean } = {},
): Promise<Work> {
  const work = await getWork(workId);
  const updated = await updateWork(work.id, {
    revision: work.revision,
    characterIds: mergeIdLists(work.characterIds, assets.characterIds),
    worldbookIds: mergeIdLists(work.worldbookIds, assets.worldbookIds),
  });
  if (!opts.shared) await attributeAssets(workId, assets);
  return updated;
}
