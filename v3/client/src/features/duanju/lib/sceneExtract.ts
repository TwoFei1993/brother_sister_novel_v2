/**
 * 场景提取（反馈 #9）：剧本 → 场景档案列表 JSON——初始生成就该有，不应手填
 */
import type { GenerateMessage } from '../../../api/llm';
import { extractJsonArray } from './json-extract';

const SYSTEM = `你是短剧美术指导。从剧本中提取全部出现过的场景/地点，输出场景档案。
只输出 JSON 数组，不要 markdown 代码块、不要解释。每项：
{"name": "场景名（简短，如：深夜食堂/货舱/紫色荒原）", "spec": "空间结构+光影基调+关键道具+色彩（40-100字，用于场景概念图生成）"}
要求：同一地点多次出现只提取一次；心理空间/纯转场不算；spec 必须可视化可画。`;

export function buildSceneExtractMessages(scriptText: string): GenerateMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `剧本：\n${scriptText}` },
  ];
}

export interface ExtractedScene {
  name: string;
  spec: string;
}

export function parseSceneExtract(raw: string): ExtractedScene[] | null {
  const arr = extractJsonArray(raw);
  if (!arr) return null;
  return arr
    .filter(
      (x): x is { name: string; spec?: string } =>
        typeof x === 'object' && x !== null && typeof (x as { name?: unknown }).name === 'string',
    )
    .map((x) => ({ name: x.name, spec: typeof x.spec === 'string' ? x.spec : '' }))
    .filter((x) => x.name.trim());
}
