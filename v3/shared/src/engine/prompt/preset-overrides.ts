/**
 * 预设条目分组识别 + 按书覆盖（用户需求 2026-11-24：「写作风格」= 预设内自带的文风条目，
 * 每本书自己选，不影响其他书；情感基调与附加选项同理可多选）。
 *
 * 背景：预设（如 Sudachi-Next-Preset）的条目启停是预设全局状态，所有绑定它的书共用；
 * 此前只能在预设管理器里手动开关，无法按书设置。本模块：
 * - detectPresetGroups：按酒馆社区预设的通用排版惯例识别「分组标题 → 组内条目」
 *   （顶级标题形如 `—\📖文风设定===` / `--\📌附加选项===`；子标题形如 `===📬新文===`），
 *   并按组名归类为 文风（单选）/ 基调（多选）/ 附加（多选）；其余组不暴露。
 * - applyPresetOverrides：把书的覆盖表（identifier → enabled）应用到 prompt_order，
 *   不改预设本身。单选组一旦被本书显式选过，组内以覆盖表为准（未写到的成员关闭）。
 */
import type { TavernPreset } from '@shared/tavern';

import { substituteParams } from './macros';
import type { MacroEnv } from '../types';

export type PresetGroupCategory = 'style' | 'tone' | 'addon';

export interface PresetGroupMember {
  identifier: string;
  name: string;
  /** 条目原文（提权注入要求块时提取文风正文用） */
  content: string;
  /** 预设默认启停（未被本书覆盖时的取值） */
  enabled: boolean;
  /** 子分组标题（如 Sudachi 文风下的「新文 / 老文」），UI 分区用 */
  subsection?: string;
}

export interface PresetGroup {
  /** 组标识 = 组名（预设内由分组标题保证唯一） */
  id: string;
  name: string;
  category: PresetGroupCategory;
  mode: 'single' | 'multi';
  members: PresetGroupMember[];
}

export const PRESET_GROUP_CATEGORY_LABELS: Record<PresetGroupCategory, string> = {
  style: '文风',
  tone: '情感基调',
  addon: '附加选项',
};

/** 条目覆盖表：identifier → 是否启用（只存本书明确改动过的条目） */
export type PresetPromptOverrides = Record<string, boolean>;

/** 顶级分组标题：`—\组名` 或 `--\组名`（em dash / 双连字符 + 反斜杠） */
const TOP_TITLE_RE = /^(?:—|--|──)\\(.+)$/;
/** 子分组标题：以两个以上 `=` 开头（按名称判定——有的子标题自带一段设置变量的内容） */
const SUB_TITLE_RE = /^={2,}/;
/** 装饰符：`===`、`---`、emoji 与杂项符号 */
const DECOR_RE = /={2,}|-{2,}|—{2,}|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

function stripDecor(name: string): string {
  return name.replace(DECOR_RE, '').trim();
}

/** 组名 → 暴露类别（其余组如常规设定/人称/越狱不暴露给按书覆盖） */
function categorize(groupName: string): PresetGroupCategory | null {
  if (/文风/.test(groupName)) return 'style';
  if (/基调|情感/.test(groupName)) return 'tone';
  if (/附加/.test(groupName)) return 'addon';
  return null;
}

/** 识别预设里可按书覆盖的分组；无分组标题的预设（如 Default）返回空数组 */
export function detectPresetGroups(preset: TavernPreset): PresetGroup[] {
  const promptById = new Map(preset.prompts.map((p) => [p.identifier, p]));
  const groups: PresetGroup[] = [];
  let current: PresetGroup | null = null;
  let subsection: string | undefined;
  for (const entry of preset.prompt_order?.[0]?.order ?? []) {
    const prompt = promptById.get(entry.identifier);
    const name = prompt?.name ?? entry.identifier;
    const content = prompt?.content ?? '';
    const top = TOP_TITLE_RE.exec(name);
    if (top) {
      const groupName = stripDecor(top[1]!);
      const category = categorize(groupName);
      current = null;
      subsection = undefined;
      if (category) {
        current = { id: groupName, name: groupName, category, mode: category === 'style' ? 'single' : 'multi', members: [] };
        groups.push(current);
      }
      continue;
    }
    // 子分组标题：`===新文===`（名称两端都是 `=`；自带变量设置内容的子标题同样只当分区名）
    if (SUB_TITLE_RE.test(name) && /={2,}$/.test(name)) {
      if (current) subsection = stripDecor(name);
      continue;
    }
    if (current) {
      current.members.push({
        identifier: entry.identifier,
        name,
        content,
        enabled: entry.enabled !== false,
        ...(subsection ? { subsection } : {}),
      });
    }
  }
  return groups.filter((g) => g.members.length > 0);
}

/** 条目正文里首个 setvar 的变量名（老文系文风把全文存进变量、条目本身消解为空） */
const SETVAR_NAME_RE = /\{\{\s*setvar\s*::\s*([^:}]+?)\s*::/;

/**
 * 提取文风组当前生效条目的文风正文（A/B 实测：预设文风块位于提示词靠前位置，输给末尾的
 * 写作纪律，三种文风产出同一腔调——需把正文提权到要求块的最高优先级区）。
 * 两种预设写法都覆盖：正文直接内联在条目里（宏替换后取剩余文本），或经 setvar 存进变量
 * （条目替换后为空 → 读该变量在本组组装中的值）。提不出返回空串（调用方不提权）。
 */
export function extractPresetStyleText(group: PresetGroup, overrides: PresetPromptOverrides, env: MacroEnv): string {
  const parts: string[] = [];
  for (const m of group.members) {
    if (!isEffective(group, m, overrides)) continue;
    const inline = substituteParams(m.content, env).trim();
    if (inline) {
      parts.push(inline);
      continue;
    }
    const varName = SETVAR_NAME_RE.exec(m.content)?.[1];
    const viaVar = varName ? (env.getVar(varName.trim(), env.scope) ?? '').trim() : '';
    if (viaVar) parts.push(viaVar);
  }
  return parts.join('\n\n');
}

/**
 * 把覆盖表应用到主预设的 prompt_order（返回新对象；无变化时返回原预设）。
 * 生效判定统一走 isEffective（单选组被本书显式选过时，组内未写到的成员关闭）。
 */
export function applyPresetOverrides(
  preset: TavernPreset,
  groups: PresetGroup[],
  overrides: PresetPromptOverrides = {},
): TavernPreset {
  if (Object.keys(overrides).length === 0) return preset;
  const memberOf = new Map<string, { group: PresetGroup; member: PresetGroupMember }>();
  for (const g of groups) for (const m of g.members) memberOf.set(m.identifier, { group: g, member: m });
  let changed = false;
  const head = preset.prompt_order?.[0];
  const order = (head?.order ?? []).map((entry) => {
    const known = memberOf.get(entry.identifier);
    const want = known ? isEffective(known.group, known.member, overrides) : overrides[entry.identifier];
    const isOn = entry.enabled !== false;
    if (want === undefined || want === isOn) return entry;
    changed = true;
    return { ...entry, enabled: want };
  });
  if (!changed || !head) return preset;
  return { ...preset, prompt_order: [{ ...head, order }] };
}

/** 组装层入口：识别分组 + 应用覆盖（server / client 组装共用，保证两处行为一致） */
export function resolveMainPreset(base: TavernPreset, overrides?: PresetPromptOverrides): TavernPreset {
  if (!overrides) return base;
  return applyPresetOverrides(base, detectPresetGroups(base), overrides);
}

/** 组装层入口：提取文风组在本书生效的文风正文（无文风组 / 提不出 → 空串，调用方不提权） */
export function resolvePresetStyle(groups: PresetGroup[], overrides: PresetPromptOverrides | undefined, env: MacroEnv): string {
  const styleGroup = groups.find((g) => g.category === 'style');
  return styleGroup ? extractPresetStyleText(styleGroup, overrides ?? {}, env) : '';
}

/** 单选组是否已被本书显式选过（组内有任一成员被覆盖表选为启用） */
function isLockedSingle(group: PresetGroup, overrides: PresetPromptOverrides): boolean {
  return group.mode === 'single' && group.members.some((m) => overrides[m.identifier] === true);
}

/**
 * 条目在本书的生效启停——应用覆盖、提取文风、界面勾选三处共用的唯一判定：
 * 单选组一旦被本书显式选过，组内以覆盖表为准（未写到的成员关闭，保证「选一个」不会与
 * 预设默认开启的那条并存）；否则覆盖优先、预设默认兜底。
 */
export function isEffective(group: PresetGroup, member: PresetGroupMember, overrides: PresetPromptOverrides): boolean {
  if (isLockedSingle(group, overrides)) return overrides[member.identifier] === true;
  return overrides[member.identifier] ?? member.enabled;
}

/**
 * 单选组点选某条：返回新的覆盖表（选中项启用、该组其余当前生效的条目关闭）。
 * 点已选中的条目不取消（文风始终有一条生效；「不用预设文风」请取消绑定主预设）。
 */
export function pickSingle(group: PresetGroup, identifier: string, overrides: PresetPromptOverrides): PresetPromptOverrides {
  const next = { ...overrides, [identifier]: true };
  for (const m of group.members) {
    if (m.identifier !== identifier && isEffective(group, m, overrides)) next[m.identifier] = false;
  }
  return next;
}

/** 多选组切换某条的生效状态，返回新的覆盖表 */
export function toggleMulti(group: PresetGroup, member: PresetGroupMember, overrides: PresetPromptOverrides): PresetPromptOverrides {
  return { ...overrides, [member.identifier]: !isEffective(group, member, overrides) };
}
