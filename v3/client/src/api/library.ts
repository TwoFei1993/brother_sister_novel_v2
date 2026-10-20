/**
 * 资产库 API 封装：四类资产 CRUD（Task 6）+ 导入导出（Task 24/25 的 /api/io/*）
 *
 * 导入导出端点统一前缀 /api/io/<type>/import|export（multipart 字段 file；
 * 导出为 POST 附件下载）。联调期若该前缀 404 属并行任务挂载中间态。
 */
import { apiFetch, ApiError } from './client';
import type { CharacterAsset } from '@shared/card';
import type { WorldbookAsset } from '@shared/worldbook';
import type { PresetAsset } from '@shared/preset';
import type { TavernPreset, TavernRegexScript } from '@shared/tavern';

/** 正则脚本资产壳（与 server RegexAsset 同构；client 唯一定义，generation-pipeline 复用） */
export interface RegexAsset {
  id: string;
  name: string;
  raw: TavernRegexScript;
}

/** 四类资产的 URL 段（与 server 挂载路径一致） */
export type AssetType = 'characters' | 'worldbooks' | 'presets' | 'regex-scripts';

/** GET /api/{characters|worldbooks|presets} 浅列表项 */
export interface LibraryAssetRef {
  id: string;
  name: string;
  /** 入库时间（毫秒时间戳；旧数据回退文件修改时间） */
  createdAt?: number;
}

/** 四类资产元信息（Tab 标签 + 导入 accept 过滤） */
export const ASSET_META: ReadonlyArray<{ id: AssetType; label: string; accept: string }> = [
  { id: 'characters', label: '角色卡', accept: '.png,.json' },
  { id: 'worldbooks', label: '世界书', accept: '.json' },
  { id: 'presets', label: '预设', accept: '.json' },
  { id: 'regex-scripts', label: '正则脚本', accept: '.json' },
];

export type AnyAsset = CharacterAsset | WorldbookAsset | PresetAsset | RegexAsset;

// ---------- 列表与详情 ----------

export async function listAssets(type: AssetType): Promise<LibraryAssetRef[]> {
  return apiFetch<LibraryAssetRef[]>(`/api/${type}`);
}

/** 兼容既有消费方（NewWorkDialog）的具名列表函数 */
export const listCharacters = (): Promise<LibraryAssetRef[]> => listAssets('characters');
export const listWorldbooks = (): Promise<LibraryAssetRef[]> => listAssets('worldbooks');
export const listPresets = (): Promise<LibraryAssetRef[]> => listAssets('presets');

/** 单资产全量详情（摘要展示用） */
export async function getAsset(type: AssetType, id: string): Promise<AnyAsset> {
  return apiFetch<AnyAsset>(`/api/${type}/${id}`);
}

export async function deleteAsset(type: AssetType, id: string): Promise<void> {
  await apiFetch(`/api/${type}/${id}`, { method: 'DELETE' });
}

// ---------- 预设详情与保存（提示词管理器） ----------

export async function getPreset(id: string): Promise<PresetAsset> {
  return apiFetch<PresetAsset>(`/api/presets/${id}`);
}

/** 保存预设：PATCH 顶层浅合并语义下整体替换 raw 字段 */
export async function updatePresetRaw(id: string, raw: TavernPreset): Promise<void> {
  await apiFetch(`/api/presets/${id}`, { method: 'PATCH', body: JSON.stringify({ raw }) });
}

/** 完整复制预设：GET 全量 → POST 新建（去掉服务端元数据，改名副本；提示词与排序原样带走） */
export async function duplicatePreset(id: string, name: string): Promise<LibraryAssetRef> {
  const { id: _omitId, createdAt: _omitAt, ...body } = await getPreset(id);
  const created = await apiFetch<{ id: string; name: string }>('/api/presets', {
    method: 'POST',
    body: JSON.stringify({ ...body, name }),
  });
  return { id: created.id, name: created.name };
}

/** 通用重命名（反馈②，四类资产）：PATCH 顶层 name（crud 工厂浅合并；列表/绑定显示名取自浅列表字段） */
export async function renameAsset(type: AssetType, id: string, name: string): Promise<void> {
  await apiFetch(`/api/${type}/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

// ---------- 导入 / 导出 ----------

/** multipart 导入：返回新建资产的引用（201） */
export async function importAsset(type: AssetType, file: File): Promise<LibraryAssetRef> {
  const fd = new FormData();
  fd.append('file', file);
  const asset = await apiFetch<{ id: string; name: string }>(`/api/io/${type}/import`, {
    method: 'POST',
    body: fd,
  });
  return { id: asset.id, name: asset.name };
}

/**
 * 导出下载：POST 附件响应 → blob → 临时 <a download> 触发保存。
 * 角色卡可指定 png/json（默认 png）；其余类型仅 json。
 */
export async function exportAsset(
  type: AssetType,
  id: string,
  opts: { name: string; format?: 'png' | 'json' },
): Promise<void> {
  const body =
    type === 'characters' ? { id, format: opts.format ?? 'png' } : { id };
  const res = await fetch(`/api/io/${type}/export`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `导出失败（${res.status}）`);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd) ?? /filename="?([^";]+)"?/.exec(cd);
  const fallbackExt = type === 'characters' && opts.format !== 'json' ? 'png' : 'json';
  const filename = m ? decodeURIComponent(m[1]) : `${opts.name || 'export'}.${fallbackExt}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- 摘要（列表描述行；防御式收窄，导入资产字段允许缺失） ----------

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function clip(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

/** 资产列表描述摘要（每类取最有信息量的一行） */
export function describeAsset(asset: AnyAsset): string {
  if ('card' in asset) {
    const d = asRecord(asset.card?.data);
    // 审计 L5：展示层把 {{char}} 宏替换为资产名（{{user}} 等其余宏保留原样，不误伤编辑语义）
    const name = text(d?.name).trim();
    const desc = (text(d?.description) || text(d?.first_mes)).replaceAll('{{char}}', name || '该角色');
    return clip(desc, 60);
  }
  const raw = asRecord(asset.raw);
  if (!raw) return '';
  const entries = asRecord(raw.entries);
  if (entries) {
    // 世界书：条目数 + 首个有备注/内容的条目
    const list = Object.values(entries).map((e) => asRecord(e)).filter(Boolean) as Record<string, unknown>[];
    const first = list.find((e) => text(e.comment) || text(e.content));
    const head = first ? text(first.comment) || text(first.content) : '';
    return `共 ${list.length} 条${head ? ` · ${clip(head, 40)}` : ''}`;
  }
  const prompts = Array.isArray(raw.prompts) ? (raw.prompts as unknown[]) : null;
  if (prompts) {
    // 预设：提示词数 + 启用数（取 character_id=100001 的排序列表）
    const groups = Array.isArray(raw.prompt_order) ? (raw.prompt_order as unknown[]) : [];
    const group = groups.map((g) => asRecord(g)).find((g) => g?.character_id === 100001) ?? asRecord(groups[0]);
    const order = Array.isArray(group?.order) ? (group.order as unknown[]) : [];
    const enabled = order.filter((o) => asRecord(o)?.enabled === true).length;
    return `提示词 ${prompts.length} 条 · 启用 ${enabled}`;
  }
  if (text(raw.scriptName) || text(raw.findRegex)) {
    // 正则脚本：find → replace 预览
    const rep = text(raw.replaceString);
    return `/${clip(text(raw.findRegex), 40)}/ → ${clip(rep || '(空)', 40)}`;
  }
  return '';
}
