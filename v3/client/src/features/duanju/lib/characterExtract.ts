/**
 * 角色提取 prompt（Phase 2）：剧本 + 人物关系 → 角色档案列表 JSON
 */
import type { GenerateMessage } from '../../../api/llm';

const SYSTEM = `你是短剧角色设计师。从剧本中提取全部有名有姓/有戏份的角色，输出角色档案。
只输出 JSON 数组，不要 markdown 代码块、不要解释。每项：
{"name": "角色名", "profile": "身份年龄+外观锚点（发色发型/瞳色/体型/标志性服装配饰，50-120字，用于生图保持一致）"}
要求：外观锚点必须从剧本可推断或合理补全；动物/机器人角色也算；群演路人不提取。`;

export function buildCharacterExtractMessages(
  scriptText: string,
  characterRelations: string,
  protagonists: string,
): GenerateMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        protagonists ? `主角设定：${protagonists}` : '',
        characterRelations ? `人物关系（审核卡）：${characterRelations}` : '',
        `剧本：\n${scriptText}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

export interface ExtractedCharacter {
  name: string;
  profile: string;
}

export function parseCharacterExtract(raw: string): ExtractedCharacter[] | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown[];
    return arr
      .filter(
        (x): x is { name: string; profile?: string } =>
          typeof x === 'object' && x !== null && typeof (x as { name?: unknown }).name === 'string',
      )
      .map((x) => ({ name: x.name, profile: typeof x.profile === 'string' ? x.profile : '' }))
      .filter((x) => x.name.trim());
  } catch {
    return null;
  }
}
