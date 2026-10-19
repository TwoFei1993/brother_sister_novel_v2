/**
 * 提示词中文简介层（第二轮体验改进）：给提示词管理器的每一行一句人话说明。
 *
 * 优先级：通用 identifier（marker/占位符位）> 名称关键词规则。
 * 都未命中返回 null（行内不显示简介）。
 */

/** 通用 identifier 说明（与装配器 blocks 键 + 常见占位符对应） */
export const PROMPT_MARKDOWN_DESC: Record<string, string> = {
  main: '主提示词（AI 的核心任务定义）',
  nsfw: '尺度提示词',
  jailbreak: '文风与越狱层（对输出影响最大的位置）',
  chatHistory: '聊天历史占位',
  worldInfoBefore: '世界书（注入在角色定义前）',
  worldInfoAfter: '世界书（注入在角色定义后）',
  charDescription: '角色卡描述占位',
  charPersonality: '角色卡性格占位',
  scenario: '角色卡情景占位',
  personaDescription: '用户人设占位',
  dialogueExamples: '对话示例占位',
  enhanceDefinitions: '增强定义',
};

/** 名称关键词规则（按声明顺序首个命中） */
const NAME_RULES: ReadonlyArray<{ test: RegExp; desc: string }> = [
  { test: /文风设定/, desc: '文风单选组：启用一条作为全文文风（如轻小说/短剧式/番剧式），其余保持停用' },
  { test: /人称设定/, desc: '人称单选组：选一条决定叙事人称' },
  { test: /COT/i, desc: '思维链：要求 AI 先思考再写正文，【始】【末】需同时启用' },
  { test: /操作区/, desc: '预留操作位，无需改动' },
  { test: /变量/, desc: '初始化预设用变量，保持启用' },
  { test: /历史/, desc: '包裹聊天历史的定界符，成对出现，保持启用' },
  { test: /备用Role/, desc: '备用角色设定，主 Role 失效时才需要' },
  { test: /^反/, desc: '对抗性规则：防止 AI 的某种常见坏习惯' },
  { test: /轻小说|短剧|鲁迅|Galgame|星野|聊天|番剧|ASMR|舞台剧/, desc: '文风选项（单选组之一）' },
  { test: /第[一二三]人称/, desc: '人称选项（单选组之一）' },
];

/** 按名称关键词推断简介（未命中返回 null） */
export function describePromptByName(name: string): string | null {
  for (const rule of NAME_RULES) {
    if (rule.test.test(name)) return rule.desc;
  }
  return null;
}

/** 行简介：通用 identifier 优先，其次名称关键词；未命中 null */
export function describePrompt(identifier: string, name: string): string | null {
  return PROMPT_MARKDOWN_DESC[identifier] ?? describePromptByName(name);
}

/** Sudachi 使用指南的分组说明（列表顶部指南卡渲染） */
export interface GuideSection {
  title: string;
  desc: string;
}

export const SUDACHI_GUIDE: ReadonlyArray<GuideSection> = [
  { title: '主提示词', desc: 'main 区，AI 的核心任务定义（写什么、怎么写）' },
  { title: 'COT', desc: '思维链：先思考再写正文，【始】【末】两段需同时启用' },
  { title: '文风单选组', desc: '启用一条作为全文文风（轻小说/短剧式/番剧式…），其余保持停用' },
  { title: '人称单选组', desc: '选一条决定叙事人称（第一/第二/第三人称）' },
  { title: '附加选项多选', desc: '❎反XX 与 🍈生动化 等附加项可按需多选' },
  { title: '操作区', desc: '预留操作位，无需改动' },
];

/** 预设名是否为 Sudachi 系（指南卡展示条件） */
export function isSudachiPreset(name: string): boolean {
  return name.includes('Sudachi');
}
