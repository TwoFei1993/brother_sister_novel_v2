/**
 * 酒馆（SillyTavern）原生格式类型与 zod schema
 *
 * 校验策略：宽松（passthrough）——酒馆 JSON 字段繁多且版本演化频繁，
 * 未知字段必须原样保留，保证导入→导出 roundtrip 不丢数据。
 * 已知字段全部 nullish 可选：兼容旧格式（如 Eldoria 的 role:null、
 * delayUntilRecursion:false 与新版模板 number 类型不一致）。
 * 字段名与酒馆 JSON 完全一致（camelCase，世界书/预设原生即如此）。
 */
import { z } from 'zod';

// ---------- 宽松标量快捷方式（全部允许缺失与 null） ----------
const lStr = z.string().nullish();
const lNum = z.number().nullish();
const lBool = z.boolean().nullish();
const lStrArr = z.array(z.string()).nullish();
const lNumArr = z.array(z.number()).nullish();

// ---------- 世界书条目（world-info.js newWorldInfoEntryDefinition 全字段） ----------
/**
 * delayUntilRecursion 新版为 number（递归延迟步数），旧导出文件里出现 boolean。
 * scanDepth/caseSensitive/matchWholeWords/useGroupScoring/sticky/cooldown/delay
 * 模板默认 null（"继承全局"），实际文件里也可能是 0/数字。
 */
export const TavernWorldInfoEntrySchema = z
  .object({
    uid: z.number(),
    key: lStrArr,
    keysecondary: lStrArr,
    comment: lStr,
    content: lStr,
    constant: lBool,
    vectorized: lBool,
    selective: lBool,
    selectiveLogic: lNum,
    addMemo: lBool,
    order: lNum,
    position: lNum,
    disable: lBool,
    ignoreBudget: lBool,
    excludeRecursion: lBool,
    preventRecursion: lBool,
    matchPersonaDescription: lBool,
    matchCharacterDescription: lBool,
    matchCharacterPersonality: lBool,
    matchCharacterDepthPrompt: lBool,
    matchScenario: lBool,
    matchCreatorNotes: lBool,
    delayUntilRecursion: z.union([z.number(), z.boolean()]).nullish(),
    probability: lNum,
    useProbability: lBool,
    depth: lNum,
    outletName: lStr,
    group: lStr,
    groupOverride: lBool,
    groupWeight: lNum,
    scanDepth: z.union([z.number(), z.null()]).optional(),
    caseSensitive: z.union([z.boolean(), z.null()]).optional(),
    matchWholeWords: z.union([z.boolean(), z.null()]).optional(),
    useGroupScoring: z.union([z.boolean(), z.null()]).optional(),
    automationId: lStr,
    role: lNum,
    sticky: lNum,
    cooldown: lNum,
    delay: lNum,
    characterFilterNames: lStrArr,
    characterFilterTags: lStrArr,
    characterFilterExclude: lBool,
    triggers: lStrArr,
  })
  .passthrough();

export type TavernWorldInfoEntry = z.infer<typeof TavernWorldInfoEntrySchema>;

/** 世界书文件顶层：{ entries: { "<uid>": entry } } */
export const TavernWorldInfoFileSchema = z
  .object({
    entries: z.record(z.string(), TavernWorldInfoEntrySchema),
  })
  .passthrough();

export type TavernWorldInfoFile = z.infer<typeof TavernWorldInfoFileSchema>;

// ---------- 预设（presets/openai/*.json，对照 Default.json 实际键） ----------
/** prompt_order 排序单元 */
export const TavernPromptOrderEntrySchema = z
  .object({
    identifier: z.string(),
    enabled: z.boolean(),
  })
  .passthrough();

/** prompt_order 分组：character_id=100001 为 chat completion 专用排序列表 */
export const TavernPromptOrderSchema = z
  .object({
    character_id: z.number(),
    order: z.array(TavernPromptOrderEntrySchema),
  })
  .passthrough();

/**
 * 单条提示词：marker=true 为占位符（worldInfoBefore/chatHistory 等不可编辑），
 * injection_position/depth/order 为深度注入扩展字段，官方 Default.json 未写（默认值）。
 */
export const TavernPromptSchema = z
  .object({
    identifier: z.string(),
    name: lStr,
    role: lStr,
    content: lStr,
    system_prompt: lBool,
    marker: lBool,
    injection_position: lNum,
    injection_depth: lNum,
    injection_order: lNum,
    injection_trigger: lStrArr,
    forbid_overrides: lBool,
  })
  .passthrough();

export type TavernPrompt = z.infer<typeof TavernPromptSchema>;

/** 预设文件：prompts 定义 + prompt_order 排序 + 采样参数（已知键宽松登记，其余 passthrough） */
export const TavernPresetSchema = z
  .object({
    prompts: z.array(TavernPromptSchema),
    prompt_order: z.array(TavernPromptOrderSchema).nullish(),
    temperature: lNum,
    frequency_penalty: lNum,
    presence_penalty: lNum,
    top_p: lNum,
    top_k: lNum,
    top_a: lNum,
    min_p: lNum,
    repetition_penalty: lNum,
    openai_max_context: lNum,
    openai_max_tokens: lNum,
    stream_openai: lBool,
    names_behavior: lNum,
    send_if_empty: lStr,
    impersonation_prompt: lStr,
    continue_nudge_prompt: lStr,
    squash_system_messages: lBool,
    assistant_prefill: lStr,
    seed: lNum,
    n: lNum,
  })
  .passthrough();

export type TavernPreset = z.infer<typeof TavernPresetSchema>;

// ---------- 正则脚本（extensions/regex 引擎，char-data.js RegexScriptData） ----------
export const TavernRegexScriptSchema = z
  .object({
    id: lStr,
    scriptName: lStr,
    findRegex: lStr,
    replaceString: lStr,
    trimStrings: lStrArr,
    placement: lNumArr,
    disabled: lBool,
    markdownOnly: lBool,
    promptOnly: lBool,
    runOnEdit: lBool,
    substituteRegex: lNum,
    minDepth: lNum,
    maxDepth: lNum,
  })
  .passthrough();

export type TavernRegexScript = z.infer<typeof TavernRegexScriptSchema>;

// ---------- 角色卡 V2（char-data.js v2CharData / v2CharDataExtensionInfos） ----------
/** 卡内嵌世界书条目（V2 spec：snake_case，与世界书原生文件不同） */
export const TavernCardBookEntrySchema = z
  .object({
    keys: lStrArr,
    secondary_keys: lStrArr,
    comment: lStr,
    content: lStr,
    constant: lBool,
    selective: lBool,
    insertion_order: lNum,
    enabled: lBool,
    position: z.union([z.string(), z.number()]).nullish(),
    id: lNum,
  })
  .passthrough();

/** 卡 extensions：depth_prompt 深度注入 + regex_scripts 正则 + 酒馆扩展 + 任意第三方字段 */
export const TavernCardExtensionsSchema = z
  .object({
    talkativeness: z.union([z.number(), z.string()]).nullish(),
    fav: z.union([z.boolean(), z.string()]).nullish(),
    world: lStr,
    // depth_prompt.role：V2 spec 为 "system"|"user"|"assistant" 字符串，酒馆世界书内部为数字枚举，两者都收
    depth_prompt: z
      .object({ prompt: lStr, depth: lNum, role: z.union([z.string(), z.number()]).nullish() })
      .passthrough()
      .nullish(),
    regex_scripts: z.array(TavernRegexScriptSchema).nullish(),
  })
  .passthrough();

/** V2 卡数据体：spec 必填字段在旧卡上可能缺失，全部宽松；未知字段（group_only_greetings 等）passthrough */
export const TavernCardV2DataSchema = z
  .object({
    name: lStr,
    description: lStr,
    personality: lStr,
    scenario: lStr,
    first_mes: lStr,
    mes_example: lStr,
    creator_notes: lStr,
    system_prompt: lStr,
    post_history_instructions: lStr,
    creator: lStr,
    character_version: lStr,
    tags: lStrArr,
    alternate_greetings: lStrArr,
    character_book: z
      .object({ name: lStr, entries: z.array(TavernCardBookEntrySchema).nullish() })
      .passthrough()
      .nullish(),
    extensions: TavernCardExtensionsSchema.nullish(),
  })
  .passthrough();

/** 顶层卡：spec='chara_card_v2'（PNG tEXt 'chara' chunk）或 v3（'ccv3'，向后兼容读取） */
export const TavernCardV2Schema = z
  .object({
    spec: z.string(),
    spec_version: lStr,
    data: TavernCardV2DataSchema,
  })
  .passthrough();

export type TavernCardV2 = z.infer<typeof TavernCardV2Schema>;
