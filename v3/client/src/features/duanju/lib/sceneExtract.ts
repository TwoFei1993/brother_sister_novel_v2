/**
 * 场景提取（反馈 #9）：剧本 → 场景档案列表 JSON——初始生成就该有，不应手填
 */
import type { GenerateMessage } from '../../../api/llm';
import { extractJsonArray } from './json-extract';

const SYSTEM = `你是短剧美术指导。从剧本中提取全部出现过的场景/地点，输出场景档案。
只输出 JSON 数组，不要 markdown 代码块、不要解释。每项：
{"name": "场景名（简短，如：深夜食堂/货舱/紫色荒原）", "spec": "视觉档案（80-150字，逐项写全）：空间布局与尺度｜建筑/陈设材质细节｜主光源方向与色温｜时间与天气氛围｜色彩基调（2-3个主色）｜关键道具及其位置"}
要求：
1. spec 必须可视化可画——生图模型看不到剧本，照搬下面的字段顺序写全；
2. 同一地点多次出现只提取一次；心理空间/纯转场不算。
好例子（照这个具体程度写）：
"4平米深夜小食店操作间：灶台沿墙一字排开，不锈钢台面油亮反光，头顶一盏冷白吊灯微微晃动；蒸汽自汤锅升腾照亮半壁白瓷砖；深夜雨夜，室外湿冷、室内燥热；暖褐与油烟灰为主调，点缀葱花绿；墙上挂褪色价目表与条形订单钩，案板角落堆着葱花与酱料碗。"`;

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
