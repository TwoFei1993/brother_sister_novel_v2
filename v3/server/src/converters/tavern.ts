/**
 * 酒馆三类资产（世界书/预设/正则）导入规范化（Task 25，设计 §4.7/§5.2）
 *
 * 保真原则：除明确的归一化字段外，输入 JSON 原样保留（schema 全 passthrough），
 * 保证导入→导出 roundtrip 不丢数据。校验失败抛 400 HttpError（人话中文），
 * 由路由错误处理器统一转 JSON。
 *
 * 归一化仅两处：
 * 1. 世界书 position：ANTop/EMTop→before、ANBottom/EMBottom→after（一期引擎只认前/后/深度）
 * 2. 预设 prompt_order：只保留 character_id=100001（chat completion）的排序列表
 */
import {
  TavernPresetSchema,
  TavernRegexScriptSchema,
  TavernWorldInfoFileSchema,
  type TavernPreset,
  type TavernRegexScript,
  type TavernWorldInfoEntry,
  type TavernWorldInfoFile,
} from '@shared/tavern';

import { HttpError, formatZodError } from '../middleware/validate';

// ---------- 世界书 ----------

/**
 * 酒馆世界书 position 枚举 → 本系统归一值（设计 §5.2）：
 *   2=ANTop、5=EMTop → 0（before）；3=ANBottom、6=EMBottom → 1（after）。
 * 0/1 原生 before/after 保留；4=atDepth（深度注入通道）保留；
 * 一期不支持的 AN/EM 精确语义按支持矩阵标注"映射到相近前后位置"。
 */
const POSITION_TO_NORMALIZED: Record<number, number> = { 2: 0, 5: 0, 3: 1, 6: 1 };

function normalizeEntryPosition(entry: TavernWorldInfoEntry): TavernWorldInfoEntry {
  if (entry.position === null || entry.position === undefined) return entry;
  const mapped = POSITION_TO_NORMALIZED[entry.position];
  if (mapped === undefined || mapped === entry.position) return entry;
  return { ...entry, position: mapped };
}

/**
 * 规范化世界书文件：zod 校验 + 位置归一化。
 * name 推断优先级：文件名（调用方从上传 originalname 剥扩展名传入）→ 首条非空 comment → 默认名。
 * 顶层未知字段（如酒馆导出的 originalData）原样保留。
 */
export function normalizeWorldbook(
  raw: unknown,
  fileName = '',
): { name: string; raw: TavernWorldInfoFile } {
  const parsed = TavernWorldInfoFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, `世界书文件不合法：${formatZodError(parsed.error)}`);
  }
  const file = parsed.data;
  const entries: Record<string, TavernWorldInfoEntry> = {};
  for (const [uid, entry] of Object.entries(file.entries)) {
    entries[uid] = normalizeEntryPosition(entry);
  }
  const firstComment = Object.values(file.entries)
    .map((entry) => entry.comment)
    .find((c): c is string => typeof c === 'string' && c.trim() !== '');
  return {
    name: fileName || firstComment || '未命名世界书',
    raw: { ...file, entries },
  };
}

// ---------- 预设 ----------

/** 酒馆 chat completion 排序列表的固定 character_id（dummy 身份，设计 §4.7） */
const CHAT_COMPLETION_CHARACTER_ID = 100001;
/** text completion 排序列表的 dummy character_id：本系统为 chat completion 形态，明确拒收 */
const TEXT_COMPLETION_CHARACTER_ID = 100000;

/**
 * 规范化预设：zod 校验 + prompt_order 收敛为 character_id=100001 一条。
 * 无 100001 条目时：仅有一条且非 text completion 专用（100000）则宽容取用
 * （社区导出常见丢 dummy 标记）；其余情况报错"缺少 chat completion 排序"。
 * name 推断：文件名 → raw.name → 默认名。
 */
export function normalizePreset(raw: unknown, fileName = ''): { name: string; raw: TavernPreset } {
  const parsed = TavernPresetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, `预设文件不合法：${formatZodError(parsed.error)}`);
  }
  const preset = parsed.data;
  const orders = preset.prompt_order ?? [];
  const sole = orders.length === 1 ? orders[0] : undefined;
  const soleTolerable =
    sole !== undefined && sole.character_id !== TEXT_COMPLETION_CHARACTER_ID;
  const chatOrder =
    orders.find((order) => order.character_id === CHAT_COMPLETION_CHARACTER_ID) ??
    (soleTolerable ? sole : undefined);
  if (!chatOrder) {
    throw new HttpError(
      400,
      '预设缺少 chat completion 排序（prompt_order 中无 character_id=100001 条目）',
    );
  }
  const embeddedName = (preset as { name?: unknown }).name;
  const name =
    fileName ||
    (typeof embeddedName === 'string' && embeddedName.trim() !== '' ? embeddedName : '未命名预设');
  return { name, raw: { ...preset, prompt_order: [chatOrder] } };
}

// ---------- 正则脚本 ----------

/**
 * 规范化正则脚本：zod 校验（passthrough 保真），无归一化字段。
 * 兜底必填：findRegex 与 scriptName 至少一个为非空字符串（schema 字段全 nullish，
 * 空壳对象也能过 zod，业务层必须挡下明显不是正则脚本的 JSON）。
 * name 推断：文件名 → scriptName → 默认名。
 */
export function normalizeRegex(
  raw: unknown,
  fileName = '',
): { name: string; raw: TavernRegexScript } {
  const parsed = TavernRegexScriptSchema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, `正则脚本文件不合法：${formatZodError(parsed.error)}`);
  }
  const script = parsed.data;
  const hasContent =
    (typeof script.findRegex === 'string' && script.findRegex !== '') ||
    (typeof script.scriptName === 'string' && script.scriptName !== '');
  if (!hasContent) {
    throw new HttpError(400, '正则脚本文件不合法：缺少 scriptName 或 findRegex 字段');
  }
  return { name: fileName || script.scriptName || '未命名正则脚本', raw: script };
}
